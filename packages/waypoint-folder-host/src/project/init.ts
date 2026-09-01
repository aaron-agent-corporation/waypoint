import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { deriveProjectSchemaName } from './backend.ts'
import {
  createWaypointProjectConfig,
  readWaypointProjectConfig,
  serializeWaypointProjectConfig,
  type WaypointPostgresBackendConfig,
  type WaypointProjectConfig,
  type WaypointProjectRootConfig,
  type WaypointProjectRuntimeConfig,
  type WaypointRouteBackendMode,
} from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

export interface InitWaypointProjectOptions {
  /**
   * Omitted on a re-init = keep the project's current quest. init used to take
   * a plain string the CLI defaulted to 'runner', so `waypoint init` on a
   * configured case silently retargeted it (rsc-g1al).
   */
  readonly quest?: string
  readonly backend?: WaypointRouteBackendMode
  readonly postgres?: WaypointPostgresBackendConfig
  /**
   * Q1 (docs/designs/q-quest-proving.md): how recipe plans execute. Omitted =
   * unconfigured — `waypoint start` refuses recipe-bearing quests until the
   * operator configures a worker (or explicitly opts into simulation).
   */
  readonly runtime?: WaypointProjectRuntimeConfig
  /**
   * Named seatbelt roots to record and materialize (rsc-w0z), typically the
   * quest's `metadata.runner.roots`. Each rw root's path is created under the
   * project so a jailed worker has its write targets; ro roots are source paths
   * the case already provides and are never created here.
   */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /**
   * OPERATOR-granted roots outside the project (rsc-rvz two-tree model: the
   * user's own case folder). Recorded verbatim, absolute paths allowed —
   * their provenance is the operator's onboarding, never quest metadata, so
   * the quest-root containment guard does not apply. Same-name quest roots
   * are overridden.
   */
  readonly externalRoots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /**
   * Discard an existing config and write a fresh one from these options alone
   * (the pre-rsc-g1al behaviour). Off by default: re-init preserves settled
   * deployment config the operator did not ask to change.
   */
  readonly force?: boolean
  readonly now?: Date
}

export interface InitWaypointProjectResult {
  readonly projectRoot: string
  readonly runnerDir: string
  readonly config: WaypointProjectConfig
  /** True when a config already existed — this was a re-init, not a create. */
  readonly existed: boolean
  /** Human-readable `field: old -> new` lines for every value this init changed. */
  readonly changes: readonly string[]
}

// Route/task/event run state lives in postgres (P5); the disk scaffold holds
// only authored content — catalogs and lifecycle YAML. `tasks` stays for the
// disk-local task discussion JSONL.
const requiredStateDirectories = ['quests', 'recipes', 'lifecycle', 'tasks'] as const

export async function initWaypointProject(
  projectRoot: string,
  options: InitWaypointProjectOptions,
): Promise<InitWaypointProjectResult> {
  const paths = getWaypointProjectPaths(projectRoot)
  // Workspace-wins on re-init (rsc-g1al). init built its config from the passed
  // options alone and overwrote config.yaml unconditionally, so `waypoint init
  // --quest <slug>` on a configured case replaced the worker command with the
  // global default — a live case began dispatching against the wrong agent
  // binary, with no warning and no diff. The catalog install path beside it
  // already preserves operator-edited recipe files; the two halves of init
  // disagreed about whose file it was.
  //
  // The rule now: an explicit option wins, else the existing config wins, else
  // the default. So an init that names only a quest changes only the quest.
  const existing = options.force === true ? null : await readExistingConfig(paths.configPath)
  // Schema-per-project (endstate Q1): a project that doesn't name a schema
  // gets a stable derived one recorded in its config, so every project on
  // the shared Console-managed instance is isolated by construction.
  // Durable defaults ON (endstate Q3: the engine advances work) — opt out
  // with an explicit `durable: false` for autopilot-driven projects.
  //
  // A re-derived schema would point the project at an EMPTY schema and orphan
  // every route in the old one, so the recorded schema is preserved hardest.
  const postgres = {
    ...existing?.backend.postgres,
    ...options.postgres,
    schema: options.postgres?.schema ?? existing?.backend.postgres?.schema ?? deriveProjectSchemaName(paths.projectRoot),
    durable: options.postgres?.durable ?? existing?.backend.postgres?.durable ?? true,
  }
  // Only record roots that stay inside the project — a quest-declared path that
  // resolves outside the case folder (`..`, absolute) is dropped rather than
  // scaffolded, so init can never create or grant write outside the project.
  // Operator-granted external roots (onboarding provenance) merge AFTER the
  // guard: the operator may grant their own tree; a quest never can.
  // Roots MERGE onto the existing map rather than replacing it: a re-init that
  // adds a quest must not revoke an operator-granted external root the case is
  // already using, and dropping a root fails a jailed dispatch closed.
  const roots = {
    ...existing?.roots,
    ...sanitizeProjectRoots(paths.projectRoot, options.roots),
    ...(options.externalRoots ?? {}),
  }
  // 'runner' only when there is nothing to preserve — on a fresh project. This
  // fallback used to arrive from the CLI on EVERY init, which is how a re-init
  // that named no quest retargeted a configured case to the starter quest.
  const quest = options.quest ?? existing?.quest ?? 'runner'
  const runtime = options.runtime ?? existing?.runtime

  const config = createWaypointProjectConfig({
    quest,
    backend: options.backend ?? existing?.backend.route,
    postgres,
    ...(runtime ? { runtime } : {}),
    ...(Object.keys(roots).length > 0 ? { roots } : {}),
    now: options.now,
  })
  const changes = existing === null ? [] : describeConfigChanges(existing, config)

  await mkdir(paths.runnerDir, { recursive: true })
  await Promise.all(requiredStateDirectories.map((name) => mkdir(join(paths.runnerDir, name), { recursive: true })))
  // Materialize each rw root so a jailed worker's write targets exist before the
  // first dispatch. ro roots are source paths the case already provides.
  await Promise.all(
    Object.values(roots)
      .filter((root) => root.access === 'rw')
      .map((root) => mkdir(resolve(paths.projectRoot, root.path), { recursive: true })),
  )
  await writeFile(paths.configPath, serializeWaypointProjectConfig(config), 'utf8')

  return {
    projectRoot: paths.projectRoot,
    runnerDir: paths.runnerDir,
    config,
    existed: existing !== null,
    changes,
  }
}

/**
 * The project's current config, or null when there is none / it is unreadable.
 *
 * Unreadable is deliberately null rather than a throw: init's job is to leave a
 * project runnable, and refusing to run because the file it is about to replace
 * is corrupt would strand the operator with no way forward. A parse failure
 * means nothing is preserved, which is the pre-existing behaviour.
 */
async function readExistingConfig(configPath: string): Promise<WaypointProjectConfig | null> {
  try {
    return await readWaypointProjectConfig(configPath)
  } catch {
    return null
  }
}

/** `field: old -> new` for every value a re-init actually changes. */
function describeConfigChanges(before: WaypointProjectConfig, after: WaypointProjectConfig): string[] {
  const changes: string[] = []
  const compare = (field: string, old: unknown, next: unknown): void => {
    const a = old === undefined ? '(unset)' : JSON.stringify(old)
    const b = next === undefined ? '(unset)' : JSON.stringify(next)
    if (a !== b) changes.push(`${field}: ${a} -> ${b}`)
  }
  compare('quest', before.quest, after.quest)
  compare('backend.route', before.backend.route, after.backend.route)
  compare('backend.postgres.schema', before.backend.postgres?.schema, after.backend.postgres?.schema)
  compare('backend.postgres.url', before.backend.postgres?.url, after.backend.postgres?.url)
  compare('backend.postgres.durable', before.backend.postgres?.durable, after.backend.postgres?.durable)
  compare('runtime', before.runtime, after.runtime)
  for (const name of new Set([...Object.keys(before.roots ?? {}), ...Object.keys(after.roots ?? {})])) {
    compare(`roots.${name}`, before.roots?.[name], after.roots?.[name])
  }
  return changes
}

/** Drop any root whose path escapes the project folder (rsc-w0z, defense in
 *  depth over the compile-time guard): init never scaffolds or records a write
 *  boundary outside the case. */
function sanitizeProjectRoots(
  projectRoot: string,
  roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined,
): Record<string, WaypointProjectRootConfig> {
  const safe: Record<string, WaypointProjectRootConfig> = {}
  for (const [name, root] of Object.entries(roots ?? {})) {
    const rel = relative(projectRoot, resolve(projectRoot, root.path))
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      continue
    }
    safe[name] = root
  }
  return safe
}
