import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parse as yamlParse } from 'yaml'

const execFileAsync = promisify(execFile)

import {
  DEFAULT_POSTGRES_URL,
  extractQuestRoots,
  extractScaffoldPlans,
  initWaypointProject,
  installQuestCatalog,
  loadBundledWaypointCatalog,
  getWaypointProjectPaths,
  readWaypointProjectConfig,
  taskKindFor,
  type WaypointProjectWorkerLaneConfig,
} from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import { withWorkerLanes, workerRuntimeFromTokens } from './worker-runtime-defaults.ts'

export async function runInitCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  // No default here (rsc-g1al): `--quest` omitted means "keep this project's
  // quest", and only a project that has none falls back to the starter. The
  // default used to be applied unconditionally, so a re-init that meant to
  // change nothing retargeted a configured case.
  const questOption = readStringOption(args, '--quest')
  const force = args.includes('--force')
  const backend = readStringOption(args, '--backend')
  // Q1 (docs/designs/q-quest-proving.md): choose how recipe plans execute at
  // init. --worker-command follows the WAYPOINT_BRIDGE_COMMAND
  // convention: one whitespace-split string, first token the binary.
  const workerCommand = readStringOption(args, '--worker-command')
  const simulated = args.includes('--simulated')
  if (workerCommand !== null && simulated) {
    io.stderr('--worker-command and --simulated are mutually exclusive.')
    return 1
  }
  if (workerCommand !== null && workerCommand.split(/\s+/).filter((token) => token !== '').length === 0) {
    io.stderr('--worker-command must name an agent binary (optionally followed by args).')
    return 1
  }
  // The worker runtime is settled deployment config, not a per-init question:
  // when neither flag is passed, fall back to `runner.worker_command` in the
  // global config (the same file the Console reads `runner.bridge_command`
  // from), so `waypoint init --quest <slug>` alone yields a runnable project.
  //
  // NOT on a re-init (rsc-g1al): this fallback is what actually swapped a
  // configured case's `pi --no-tools` for the global `claude`. It exists so a
  // FRESH `waypoint init --quest <slug>` is runnable, not to relitigate a worker
  // the operator already chose. `--worker-command` still overrides explicitly.
  const projectRoot = io.cwd ?? process.cwd()
  // What this project already is, before init decides what to change.
  const existingConfig = force ? null : await readExistingProjectConfig(projectRoot)
  const globalWorkerCommand =
    workerCommand === null && !simulated && existingConfig?.runtime === undefined
      ? await readGlobalWorkerCommand()
      : null
  const effectiveWorkerCommand = workerCommand ?? globalWorkerCommand
  const workerTokens =
    effectiveWorkerCommand === null ? [] : effectiveWorkerCommand.split(/\s+/).filter((token) => token !== '')
  // A global-default worker brings the global subscription pool with it, so
  // lane-health failover works from the first dispatch; an explicit
  // --worker-command stays exactly the single worker the operator named.
  const globalLanes = globalWorkerCommand !== null ? await readGlobalWorkerLanes() : null
  const runtime =
    workerTokens.length > 0
      ? globalLanes !== null && workerCommand === null
        ? withWorkerLanes(workerRuntimeFromTokens(workerTokens), globalLanes)
        : workerRuntimeFromTokens(workerTokens)
      : simulated
        ? { recipe: 'null' as const }
        : undefined
  if (backend !== null && backend !== 'postgres') {
    io.stderr(
      backend === 'folder' || backend === 'beads'
        ? `The '${backend}' route backend is retired — new projects run on postgres (P5). Use 'waypoint migrate' to move an existing ${backend} project.`
        : 'Invalid --backend value. Expected postgres.',
    )
    return 1
  }
  const postgresUrl = readStringOption(args, '--postgres-url')
  const postgresSchema = readStringOption(args, '--postgres-schema')
  const postgresDurable = args.includes('--postgres-durable')
  const postgresNoDurable = args.includes('--postgres-no-durable')
  if (postgresDurable && postgresNoDurable) {
    io.stderr('--postgres-durable and --postgres-no-durable are mutually exclusive.')
    return 1
  }
  // Durable defaults ON (endstate Q3); --postgres-no-durable opts a project
  // into plain postgres driven by `waypoint auto`.
  const postgres = {
    ...(postgresUrl ? { url: postgresUrl } : {}),
    ...(postgresSchema ? { schema: postgresSchema } : {}),
    ...(postgresNoDurable ? { durable: false } : {}),
  }
  // The quest is resolved HERE and not only inside initWaypointProject, because
  // the roots to scaffold and the catalog to install are both keyed by it — a
  // re-init that preserved the quest in config while installing the starter
  // quest's manifests would be a subtler version of the same bug.
  const quest = questOption ?? existingConfig?.quest ?? 'runner'
  // WAYPOINT_CATALOG_ROOT — a test-owned catalog in place of the bundled one.
  //
  // Suites that drive the real engine need a quest with a settled SHAPE (two
  // sequential recipe plans, a gate per wave, a repeat variant). Borrowing a
  // product quest for that couples a test harness to content that moves for
  // product reasons: D6 deleted `code-review` and the durable bridge suite's
  // 27 tests broke instantly — and nobody saw it, because that suite was
  // skip-gated on an env var and had been reporting green over an empty set
  // for months (Phase 0, item 10). A fixture catalog the test owns cannot be
  // deleted out from under it.
  //
  // Product behaviour is untouched: unset, this is exactly the bundled load.
  const catalogRoot = process.env.WAYPOINT_CATALOG_ROOT?.trim()
  const catalog = await loadBundledWaypointCatalog(catalogRoot ? { root: catalogRoot } : {})
  // Seatbelt roots (rsc-w0z): materialize the quest's declared named roots into
  // the project config so a jailed dispatch resolves every plan `Access:`
  // binding instead of failing closed at "config declares no such root".
  const roots = extractQuestRoots(catalog.quests.get(quest)?.metadata)
  const result = await initWaypointProject(projectRoot, {
    quest,
    postgres,
    ...(runtime ? { runtime } : {}),
    ...(Object.keys(roots).length > 0 ? { roots } : {}),
    ...(force ? { force: true } : {}),
  })
  const installed = await installQuestCatalog(projectRoot, catalog, { quest })
  await enableGitPerformanceConfig(projectRoot, io)

  // Never claim to have "Initialized" a project that already existed, and never
  // change a settled value without printing it (rsc-g1al). The clobber was bad;
  // the silence was what made it cost an afternoon.
  if (!result.existed) {
    io.stdout(`Initialized project at ${result.projectRoot}`)
  } else if (result.changes.length === 0) {
    io.stdout(`Already initialized at ${result.projectRoot} — config unchanged.`)
  } else {
    io.stdout(`Re-initialized project at ${result.projectRoot} — ${result.changes.length} config change(s):`)
    for (const change of result.changes) io.stdout(`  ${change}`)
  }
  io.stdout(`quest: ${result.config.quest}`)
  io.stdout(`run backend: ${result.config.backend.route}`)
  io.stdout(`postgres url: ${result.config.backend.postgres?.url ?? `${DEFAULT_POSTGRES_URL} (managed default)`}`)
  io.stdout(`postgres schema: ${result.config.backend.postgres?.schema}`)
  io.stdout(`durable engine: ${result.config.backend.postgres?.durable === true}`)
  io.stdout(
    `recipe runtime: ${
      result.config.runtime.recipe === 'worker'
        ? `worker (${result.config.runtime.worker?.command})${globalWorkerCommand !== null ? ' — from global config runner.worker_command' : ''}`
        : result.config.runtime.recipe === 'null'
          ? 'simulated (explicit opt-in; outcomes are recorded simulated, never executed)'
          : (result.config.runtime.recipe ?? 'not configured')
    }`,
  )
  io.stdout(`config: ${result.runnerDir}/config.yaml`)
  // Roots MERGE on re-init so a switch cannot revoke a root an in-flight route
  // still needs — but a merge only ever widens the write jail, and this project
  // guards that map hard (rsc-w0z). Anything retained that the current quest
  // does not declare gets named, so widening is a decision rather than a
  // side effect. Retained operator-granted external roots show up here too,
  // which is correct: they are exactly what a reader should confirm.
  const retained = Object.keys(result.config.roots ?? {}).filter((name) => !(name in roots))
  if (result.existed && retained.length > 0) {
    io.stderr(
      `note: ${retained.length} root(s) kept from the previous config that quest '${quest}' does not declare — ` +
        `${retained.join(', ')}. They still grant a jailed worker access. Remove them from ` +
        `${result.runnerDir}/config.yaml, or re-init with --force to rebuild the config from this quest alone.`,
    )
  }
  if (result.config.roots) {
    const summary = Object.entries(result.config.roots)
      .map(([name, root]) => `${name}=${root.path} (${root.access})`)
      .join(', ')
    io.stdout(`seatbelt roots: ${summary}`)
  }
  // Q1: say NOW what start will refuse LATER — an operator who inits a
  // recipe-bearing quest without a runtime should not discover it at start.
  if (result.config.runtime.recipe === null && (await questHasRecipePlans(result.runnerDir, quest))) {
    io.stderr(
      `warning: quest '${quest}' contains recipe plans but no runtime is configured — 'waypoint start' will refuse. ` +
        'Re-run with --worker-command "<agent cmd>" (an agent executes the work) or --simulated (explicit simulation), ' +
        'set runner.worker_command in the global config (~/.waypoint/config.yaml), ' +
        'or edit runtime.recipe in .waypoint/config.yaml.',
    )
  }
  io.stdout(`installed Quest manifests: ${installed.installedQuestPaths.length}`)
  io.stdout(`installed task quest manifests: ${installed.installedRecipePaths.length}`)
  if (installed.installedSkillPaths.length > 0) {
    io.stdout(`installed skills: ${installed.installedSkillPaths.length}`)
  }
  return 0
}

/**
 * Enable git's fsmonitor + untrackedCache on the project's repo (rsc-rlf).
 *
 * On a large project tree (150k+ working-tree entries) `git
 * status` runs ~5s uncached; with these two on it drops to ~0.65s steady state,
 * which is what the Console's git-status probe (rsc-d0w) actually waits on. Both
 * are safe, widely-recommended defaults, so init sets them UNCONDITIONALLY —
 * this is a settled decision, encoded once, not a tune an operator should have
 * to rediscover (it was enabled by hand on the Whaley vault, 2026-07-14).
 *
 * Best-effort and non-fatal: a host without git, or a project dir that is not a
 * work tree, is a clean no-op. An ergonomic tune must never fail `waypoint init`.
 * `git -C <root> config` writes the LOCAL config of the repo that contains the
 * project, which is exactly the vault repo we mean.
 */
export async function enableGitPerformanceConfig(projectRoot: string, io: WaypointCliIo): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'])
    if (stdout.trim() !== 'true') return
  } catch {
    return // no git on PATH, or not a repo — nothing to tune
  }
  const applied: string[] = []
  for (const [key, value] of [
    ['core.fsmonitor', 'true'],
    ['core.untrackedCache', 'true'],
  ] as const) {
    try {
      await execFileAsync('git', ['-C', projectRoot, 'config', key, value])
      applied.push(`${key}=${value}`)
    } catch {
      // Best-effort per setting: an old git that rejects one still gets the other.
    }
  }
  if (applied.length > 0) {
    io.stdout(`git performance: set ${applied.join(', ')} (faster git status on large vaults — rsc-rlf)`)
  }
}

/**
 * Global default worker command: `runner.worker_command` in
 * `<config home>/config.yaml` (WAYPOINT_CONFIG_HOME honored, as the
 * bridge registry does). Same one-string whitespace-split convention as
 * `--worker-command`. Tolerant read — a missing/unparseable file or a
 * non-string value is simply "no default", never an init failure.
 */
export async function readGlobalWorkerCommand(): Promise<string | null> {
  return readGlobalRunnerString('worker_command')
}

/**
 * The operator's machine-level subscription pool: `runner.worker_lanes` in
 * the global config, same shape as a project's `runtime.worker.lanes` (one
 * lane per subscription — name, email, command, credential-home env,
 * model_args). Scaffolded into new cases whose worker command came from the
 * global default, so lane-health failover works from day one. Tolerant read:
 * missing, empty, or malformed means "no pool" — the project-config parser
 * re-validates whatever lands in a case, fail-closed.
 */
export async function readGlobalWorkerLanes(): Promise<readonly WaypointProjectWorkerLaneConfig[] | null> {
  const home = process.env.WAYPOINT_CONFIG_HOME?.trim()
  const path = join(home !== undefined && home !== '' ? home : join(homedir(), '.waypoint'), 'config.yaml')
  try {
    const parsed = yamlParse(await readFile(path, 'utf8')) as { runner?: Record<string, unknown> } | null
    const raw = parsed?.runner?.worker_lanes
    if (!Array.isArray(raw) || raw.length === 0) return null
    const lanes = raw.filter(
      (row): row is Record<string, unknown> =>
        row !== null && typeof row === 'object' && !Array.isArray(row) && typeof row.name === 'string',
    )
    // Shape beyond `name` is re-validated by the project-config parser at
    // case load, fail-closed — this read only refuses obvious non-lanes.
    return lanes.length === raw.length ? (lanes as unknown as readonly WaypointProjectWorkerLaneConfig[]) : null
  } catch {
    return null
  }
}

async function readGlobalRunnerString(key: string): Promise<string | null> {
  const home = process.env.WAYPOINT_CONFIG_HOME?.trim()
  const path = join(home !== undefined && home !== '' ? home : join(homedir(), '.waypoint'), 'config.yaml')
  try {
    const parsed = yamlParse(await readFile(path, 'utf8')) as { runner?: Record<string, unknown> } | null
    const raw = parsed?.runner?.[key]
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null
  } catch {
    return null
  }
}

/** Q1: does the just-installed local quest manifest carry recipe plans? */
async function questHasRecipePlans(runnerDir: string, quest: string): Promise<boolean> {
  try {
    const parsed = yamlParse(await readFile(join(runnerDir, 'quests', `${quest}.yaml`), 'utf8')) as {
      scaffolds?: unknown
    } | null
    if (!parsed) return false
    return extractScaffoldPlans(parsed.scaffolds).some((plan) => taskKindFor(plan.metadata) === 'recipe')
  } catch {
    return false
  }
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}

/**
 * The project's current config, or null when it has none / it is unreadable
 * (rsc-g1al). Read before init decides anything, so an omitted flag can mean
 * "keep what this project already has" rather than "apply the default".
 */
async function readExistingProjectConfig(projectRoot: string) {
  try {
    return await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
  } catch {
    return null
  }
}
