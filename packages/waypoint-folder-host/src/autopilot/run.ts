import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

import { parseRecipeManifest } from '@waypoint-engine/core'
import { appendRouteEvent } from '../events/jsonl.ts'
import { isDurablePostgresRouteBackend } from '../project/backend.ts'
import { readWaypointProjectConfig } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from '../routes/store.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'
import { type RecipeRuntimePriorAttempt } from '../runtime/work-order.ts'
import { DeterministicRecipeRuntime } from '../runtime/deterministic-runtime.ts'
import { cordisRecipeRuntimeFor } from '../runtime/cordis-runtime-for.ts'
import { piRecipeRuntimeFor } from '../runtime/pi-runtime-for.ts'
import { LocalRecipeRuntime } from '../runtime/local-runtime.ts'
import { NullRecipeRuntime, UnconfiguredRecipeRuntime } from '../runtime/null-runtime.ts'
import { WorkerRecipeRuntime } from '../runtime/worker-runtime.ts'
import { loadWorkspaceWaypointCatalog } from '../catalog/workspace.ts'

import type { RecipeManifest } from '@waypoint-engine/core'
import type {
  RunWaypointAutopilotOptions,
  RunWaypointAutopilotResult,
  WaypointAutopilotRunPage,
  WaypointAutopilotRunRecord,
  WaypointAutopilotRunStatus,
} from './types.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'

const DEFAULT_MAX_ITERATIONS = 20

export async function runWaypointAutopilot(
  projectRoot: string,
  options: RunWaypointAutopilotOptions = {},
): Promise<RunWaypointAutopilotResult> {
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    throw new Error(
      'Durable postgres routes are engine-driven; "waypoint auto" does not apply. Decide gates with "waypoint gate"; watch progress with "waypoint tasks".',
    )
  }

  const routeId = options.routeId ?? (await defaultRouteId(projectRoot))
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(`Autopilot max iterations must be a positive integer: ${maxIterations}`)
  }

  const runtime = await createRecipeRuntime(projectRoot)
  const completedTasks: string[] = []
  let iterations = 0
  let status: WaypointAutopilotRunStatus = 'complete'
  let blockedNode: string | null = null

  while (iterations < maxIterations) {
    if (options.signal?.aborted) {
      status = 'cancelled'
      await updateWaypointRoute(projectRoot, routeId, { status: 'cancelled', updated_at: timestampFor(options.now) })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.cancelled',
        now: options.now,
        payload: { completed_tasks: completedTasks },
      })
      break
    }

    const nextTask = await nextOpenTask(projectRoot, routeId)
    if (!nextTask) {
      status = 'complete'
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'complete',
        current_node: null,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.complete',
        now: options.now,
        payload: { completed_tasks: completedTasks },
      })
      break
    }

    iterations += 1

    if (nextTask.kind === 'gate') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'blocked',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'blocked',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.blocked',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, reason: 'human_gate' },
      })
      break
    }

    if (nextTask.kind === 'checkpoint') {
      const missingArtifacts = await missingOutputArtifacts(projectRoot, nextTask)
      if (missingArtifacts.length > 0) {
        status = 'blocked'
        blockedNode = nextTask.plan_ref
        await blockTaskForMissingArtifacts(projectRoot, routeId, nextTask, missingArtifacts, options.now)
        break
      }
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'done',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'active',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.checkpoint.completed',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref },
      })
      completedTasks.push(nextTask.id)
      continue
    }

    if (isUnsupportedAutopilotTask(nextTask)) {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'blocked',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'blocked',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.unsupported_node',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, kind: nextTask.kind },
      })
      break
    }

    const recipeSlug = recipeSlugForTask(nextTask)
    const recipe = runtime instanceof NullRecipeRuntime ? null : await loadRecipeManifest(projectRoot, recipeSlug, options.catalogDir)
    const priorAttempt = priorFailedAttemptForTask(nextTask)
    let output: { readonly status: string; readonly runtime: string }
    if (recipe?.runtime?.kind === 'deterministic') {
      // Deterministic recipe (B2): a vetted host step, not an agent. Plain-mode
      // local file assembly is exactly what the autopilot CAN safely run, so
      // route it through the deterministic runtime — same Seatbelt jail, exit-code
      // outcome, no prompt/report — instead of the configured agent runtime. This
      // is the identical fork the durable bridge takes; without it, referral
      // quests fail-closed at assemble-package in plain mode (rsc-8is).
      const detRuntime = await deterministicRuntimeFor(projectRoot)
      const access = accessForTask(nextTask)
      output = await detRuntime.runRecipe({
        routeId,
        taskId: nextTask.id,
        recipe: recipe.slug,
        ...(recipe.runtime.entrypoint ? { entrypoint: recipe.runtime.entrypoint } : {}),
        projectRoot,
        outputArtifacts: outputArtifactsForTask(nextTask),
        ...(access ? { access } : {}),
        signal: options.signal,
      })
    } else if (recipe?.runtime?.kind === 'pi') {
      // Pi recipe (rsc-tka): run the in-process pi-agent-core loop instead of
      // spawning claude -p — the same fork the durable bridge takes. Model
      // routing, granted tools, and the report claim are the runtime's; the
      // graph/task/event flow is identical to an agent recipe's.
      const piRuntime = await piRecipeRuntimeFor(projectRoot)
      const access = accessForTask(nextTask)
      output = await piRuntime.runRecipe({
        routeId,
        taskId: nextTask.id,
        recipe: recipe.slug,
        prompt: recipe.prompt,
        projectRoot,
        ...(recipe.runtime.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        ...(recipe.tools ? { tools: recipe.tools } : {}),
        ...(access ? { access } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: options.signal,
      })
    } else if (recipe?.runtime?.kind === 'cordis') {
      // Cordis recipe (the Waypoint harness) — the same fork the durable bridge
      // takes. Composition, model routing and the report claim are the
      // runtime's; the graph/task/event flow is identical to an agent recipe's.
      const cordisRuntime = await cordisRecipeRuntimeFor(projectRoot)
      const access = accessForTask(nextTask)
      output = await cordisRuntime.runRecipe({
        routeId,
        taskId: nextTask.id,
        recipe,
        prompt: recipe.prompt,
        projectRoot,
        ...(recipe.runtime.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        outputArtifacts: outputArtifactsForTask(nextTask),
        ...(access ? { access } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: options.signal,
      })
    } else {
      output = await runtime.runRecipe({
        routeId,
        taskId: nextTask.id,
        recipe: recipe?.slug ?? recipeSlug,
        prompt: recipe?.prompt ?? '',
        projectRoot,
        outputArtifacts: outputArtifactsForTask(nextTask),
        ...(recipe?.runtime?.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: options.signal,
      })
    }
    if (output.status === 'stopped') {
      status = 'cancelled'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'cancelled',
        updated_at: timestampFor(options.now),
        metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'cancelled',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.cancelled',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
      })
      break
    }
    if (output.status === 'exhausted') {
      // Budget ran out with the worker's bead still open — work is retained.
      // Blocked, not failed: the operator retries with a bigger budget.
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'blocked',
        updated_at: timestampFor(options.now),
        metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output, block_reason: 'runtime_exhausted' }),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'blocked',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.task.exhausted',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
      })
      break
    }
    if (output.status === 'failed') {
      status = 'failed'
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'failed',
        updated_at: timestampFor(options.now),
        metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'failed',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.task.failed',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
      })
      break
    }
    const missingArtifacts = await missingOutputArtifacts(projectRoot, nextTask)
    if (missingArtifacts.length > 0) {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockTaskForMissingArtifacts(projectRoot, routeId, nextTask, missingArtifacts, options.now, output)
      break
    }
    await updateWaypointTask(projectRoot, nextTask.id, {
      status: 'done',
      updated_at: timestampFor(options.now),
      metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
    })
    await updateWaypointRoute(projectRoot, routeId, {
      status: 'active',
      current_node: nextTask.plan_ref,
      updated_at: timestampFor(options.now),
    })
    await appendRouteEvent(projectRoot, routeId, {
      kind: autopilotRuntimeExecutes(output.runtime) ? 'route.autopilot.task.executed' : 'route.autopilot.task.simulated',
      now: options.now,
      payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
    })
    completedTasks.push(nextTask.id)
  }

  if (iterations >= maxIterations && status === 'complete') {
    status = 'iteration_cap'
    await appendRouteEvent(projectRoot, routeId, {
      kind: 'route.autopilot.iteration_cap',
      now: options.now,
      payload: { max_iterations: maxIterations, completed_tasks: completedTasks },
    })
  }

  const run = await appendAutopilotRun(projectRoot, {
    route_id: routeId,
    status,
    iterations,
    completed_tasks: completedTasks,
    blocked_node: blockedNode,
    now: options.now,
  })

  return { run, status, routeId, iterations, completedTasks, blockedNode }
}

export async function listWaypointAutopilotRuns(
  projectRoot: string,
  options: { readonly limit?: number; readonly offset?: number } = {},
): Promise<WaypointAutopilotRunPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Autopilot run limit must be a positive integer: ${limit}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`Autopilot run offset must be a non-negative integer: ${offset}`)
  const runs = await readAllAutopilotRuns(projectRoot)
  return { items: runs.slice(offset, offset + limit), total: runs.length, limit, offset }
}

/**
 * Which runtimes REALLY run the recipe: local spawns a command, worker spawns
 * the agent itself (P4 truthfulness fix — worker was recorded 'simulated'),
 * deterministic runs a vetted host entrypoint (rsc-8is). 'null' simulates by
 * definition. The record must never claim more or less than what happened
 * (2026-05-06 rule).
 */
export function autopilotRuntimeExecutes(runtime: string): boolean {
  return runtime === 'local' || runtime === 'worker' || runtime === 'deterministic' || runtime === 'pi'
}

/**
 * Build the deterministic runtime for a project (rsc-8is) — the same
 * construction the durable bridge uses: named roots + worker task timeout from
 * config feed the Seatbelt jail, defaults on any config read failure.
 */
async function deterministicRuntimeFor(projectRoot: string): Promise<DeterministicRecipeRuntime> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return new DeterministicRecipeRuntime({
      ...(config.roots ? { roots: config.roots } : {}),
      ...(config.runtime.worker?.task_timeout_minutes
        ? { timeoutMs: config.runtime.worker.task_timeout_minutes * 60_000 }
        : {}),
    })
  } catch {
    return new DeterministicRecipeRuntime()
  }
}

/** The plan's `access:` map from task metadata (runner.access), for the jail. */
function accessForTask(task: WaypointFolderTask): Record<string, string> | undefined {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  if (!isRecord(runner.access)) return undefined
  const access: Record<string, string> = {}
  for (const [binding, mode] of Object.entries(runner.access)) {
    if (typeof mode === 'string') access[binding] = mode
  }
  return access
}

/**
 * The worker POOL: one runtime per configured lane, in declaration order.
 *
 * A lane is a subscription (Aaron 2026-07-28) — its own binary, its own
 * credential env, its own class→model mapping. The bridge runs one dispatch
 * per lane, so the ceiling is how many plans the operator has rather than how
 * hard one plan can be pushed before it rate-limits.
 *
 * Returns a single unnamed lane for every other runtime kind, so the caller
 * has one shape to hold.
 */
export async function createRecipeRuntimeLanes(
  projectRoot: string,
): Promise<
  readonly {
    readonly name: string | null
    readonly email?: string
    readonly runtime: Awaited<ReturnType<typeof createRecipeRuntime>>
  }[]
> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  const lanes = config.runtime.recipe === 'worker' ? config.runtime.worker?.lanes : undefined
  if (!lanes || lanes.length === 0) {
    return [{ name: null, runtime: await createRecipeRuntime(projectRoot) }]
  }
  const worker = config.runtime.worker
  return lanes.map((lane) => {
    const command = lane.command ?? worker?.command
    if (!command) {
      throw new Error(
        `Worker lane ${lane.name} has no command: set runtime.worker.lanes[].command or runtime.worker.command in .waypoint/config.yaml`,
      )
    }
    const modelArgs = lane.model_args ?? worker?.model_args
    const args = lane.args ?? worker?.args
    return {
      name: lane.name,
      ...(lane.email ? { email: lane.email } : {}),
      runtime: new WorkerRecipeRuntime({
        command,
        laneName: lane.name,
        ...(lane.email ? { laneEmail: lane.email } : {}),
        ...(lane.work_order ? { workOrderVia: lane.work_order } : {}),
        ...(args ? { args } : {}),
        ...(modelArgs ? { modelArgs } : {}),
        ...(lane.env ? { envInject: lane.env } : {}),
        ...(worker?.task_timeout_minutes ? { timeoutMs: worker.task_timeout_minutes * 60_000 } : {}),
        ...(worker?.verify_then_apply ? { verifyThenApply: true } : {}),
        ...(config.roots ? { roots: config.roots } : {}),
        ...(config.runtime.sandbox ? { sandbox: config.runtime.sandbox } : {}),
        ...(worker?.env_allow ? { envAllow: worker.env_allow } : {}),
      }),
    }
  })
}

export async function createRecipeRuntime(
  projectRoot: string,
): Promise<NullRecipeRuntime | LocalRecipeRuntime | WorkerRecipeRuntime> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  if (config.runtime.recipe === 'worker') {
    // P3/W4: the worker host — the bridge spawns the agent command directly.
    const worker = config.runtime.worker
    if (!worker?.command) throw new Error('Worker runtime requires runtime.worker.command in .waypoint/config.yaml')
    return new WorkerRecipeRuntime({
      command: worker.command,
      ...(worker.args ? { args: worker.args } : {}),
      ...(worker.model_args ? { modelArgs: worker.model_args } : {}),
      ...(worker.task_timeout_minutes ? { timeoutMs: worker.task_timeout_minutes * 60_000 } : {}),
      ...(worker.verify_then_apply ? { verifyThenApply: true } : {}),
      ...(config.roots ? { roots: config.roots } : {}),
      // rsc-3yf: opt-in per project. Absent = today's behavior, unchanged.
      ...(config.runtime.sandbox ? { sandbox: config.runtime.sandbox } : {}),
      // rsc-m8x: extra names on top of the built-in env allowlist. Absent means
      // the built-in list alone — the allowlist itself is NOT opt-in.
      ...(worker.env_allow ? { envAllow: worker.env_allow } : {}),
    })
  }
  if (config.runtime.recipe === 'local') {
    if (!config.runtime.command) throw new Error('Local Recipe runtime requires runtime.command in .waypoint/config.yaml')
    return new LocalRecipeRuntime({ command: config.runtime.command, args: config.runtime.args ?? [] })
  }
  // Q1: explicit 'null' is a deliberate opt-in to simulated outcomes; UNSET is
  // not — an unconfigured project gets the runtime that refuses to run
  // recipes, so nothing is ever silently marked simulated (rsc-e1b).
  if (config.runtime.recipe === 'null') return new NullRecipeRuntime()
  return new UnconfiguredRecipeRuntime()
}

export async function loadRecipeManifest(projectRoot: string, recipeSlug: string, catalogDir?: string): Promise<RecipeManifest> {
  if (catalogDir) {
    // Ad-hoc overlay path — unchanged: scan the supplied catalogDir only (D5).
    const recipeDirectory = join(catalogDir, 'recipes')
    for (const filePath of await walkYamlFiles(recipeDirectory)) {
      const parsed = parseRecipeManifest(await readFile(filePath, 'utf8'))
      if (parsed.ok && parsed.manifest.slug === recipeSlug) return parsed.manifest
    }
    throw new Error(`Recipe not found in local catalog: ${recipeSlug}`)
  }

  // Default path: locate the winning recipe file via the workspace overlay
  // (workspace > bundled). Re-parse from disk to enforce runtime validation
  // (e.g. non-empty prompt) rather than relying on the weaker catalog type guard.
  const catalog = await loadWorkspaceWaypointCatalog(projectRoot)
  const entry = catalog.recipeEntries.find((candidate) => candidate.slug === recipeSlug)
  if (!entry) throw new Error(`Recipe not found in local catalog: ${recipeSlug}`)
  const parsed = parseRecipeManifest(await readFile(entry.path, 'utf8'))
  if (!parsed.ok) throw new Error(`invalid Recipe manifest: ${entry.path}: ${parsed.error.message}`)
  return parsed.manifest
}

async function walkYamlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkYamlFiles(full)))
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      out.push(full)
    }
  }
  return out.sort()
}

async function blockTaskForMissingArtifacts(
  projectRoot: string,
  routeId: string,
  task: WaypointFolderTask,
  missingArtifacts: readonly string[],
  now?: Date,
  runtimeOutput?: unknown,
): Promise<void> {
  await updateWaypointTask(projectRoot, task.id, {
    status: 'blocked',
    updated_at: timestampFor(now),
    metadata: mergeTaskMetadata(task.metadata, {
      ...(runtimeOutput ? { autopilot: runtimeOutput } : {}),
      missing_artifacts: missingArtifacts,
      block_reason: 'required_artifacts_missing',
    }),
  })
  await updateWaypointRoute(projectRoot, routeId, {
    status: 'blocked',
    current_node: task.plan_ref,
    updated_at: timestampFor(now),
  })
  await appendRouteEvent(projectRoot, routeId, {
    kind: 'route.autopilot.required_artifacts_missing',
    now,
    payload: { task_id: task.id, node: task.plan_ref, missing_artifacts: missingArtifacts },
  })
}

async function missingOutputArtifacts(projectRoot: string, task: WaypointFolderTask): Promise<string[]> {
  const artifacts = outputArtifactsForTask(task)
  const missing: string[] = []
  for (const artifact of artifacts) {
    const safePath = safeRelativeArtifactPath(artifact)
    if (!safePath) {
      missing.push(artifact)
      continue
    }
    try {
      const fullPath = join(projectRoot, safePath)
      await stat(fullPath)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(artifact)
        continue
      }
      throw error
    }
  }
  return missing
}

/**
 * Retry evidence (rsc-f3v): a task re-opened by `waypoint tasks retry` still
 * carries the failed run's full output under metadata.runner.autopilot (the
 * retry verb flips status only). When that record says 'failed', the next
 * dispatch feeds its real evidence — verify-then-apply misses, close reason,
 * raw output — into the new work order instead of starting blind. A
 * successful re-run overwrites the record, so evidence never goes stale.
 */
function priorFailedAttemptForTask(task: WaypointFolderTask): RecipeRuntimePriorAttempt | undefined {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const prior = isRecord(runner.autopilot) ? runner.autopilot : null
  if (prior === null || prior.status !== 'failed') return undefined
  const apply = isRecord(prior.apply) ? prior.apply : {}
  const missing = Array.isArray(apply.missing)
    ? apply.missing.filter((item): item is string => typeof item === 'string')
    : []
  const stdout = typeof prior.stdout === 'string' ? prior.stdout.trim() : ''
  const stderr = typeof prior.stderr === 'string' ? prior.stderr.trim() : ''
  return {
    status: 'failed',
    close_reason: typeof prior.close_reason === 'string' ? prior.close_reason : null,
    missing,
    output_tail: [stdout, stderr && stdout ? `--- stderr ---\n${stderr}` : stderr].filter((part) => part !== '').join('\n'),
  }
}

export function outputArtifactsForTask(task: WaypointFolderTask): string[] {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  if (!Array.isArray(runner.output_artifacts)) return []
  return runner.output_artifacts.filter((artifact): artifact is string => typeof artifact === 'string' && artifact.trim().length > 0)
}

function safeRelativeArtifactPath(artifact: string): string | null {
  const normalized = normalize(artifact.trim())
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) return null
  return normalized
}

async function defaultRouteId(projectRoot: string): Promise<string> {
  const routes = await listWaypointRoutes(projectRoot)
  const route = routes.find((item) => item.status === 'active') ?? routes[0]
  if (!route) throw new Error('No Waypoint routes found')
  return route.id
}

async function nextOpenTask(projectRoot: string, routeId: string): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointTasks(projectRoot)
  return tasks.find((task) => task.route_id === routeId && task.status === 'open') ?? null
}

async function appendAutopilotRun(
  projectRoot: string,
  input: {
    readonly route_id: string
    readonly status: WaypointAutopilotRunStatus
    readonly iterations: number
    readonly completed_tasks: readonly string[]
    readonly blocked_node: string | null
    readonly now?: Date
  },
): Promise<WaypointAutopilotRunRecord> {
  const existing = await readAllAutopilotRuns(projectRoot)
  const timestamp = timestampFor(input.now)
  const run: WaypointAutopilotRunRecord = {
    id: `autopilot-run-${String(existing.length + 1).padStart(3, '0')}`,
    route_id: input.route_id,
    status: input.status,
    iterations: input.iterations,
    completed_tasks: input.completed_tasks,
    blocked_node: input.blocked_node,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await mkdir(autopilotDirectory(projectRoot), { recursive: true })
  await appendFile(autopilotRunsPath(projectRoot), `${JSON.stringify(run)}\n`, 'utf8')
  return run
}

async function readAllAutopilotRuns(projectRoot: string): Promise<WaypointAutopilotRunRecord[]> {
  let raw: string
  try {
    raw = await readFile(autopilotRunsPath(projectRoot), 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WaypointAutopilotRunRecord)
}

function recipeSlugForTask(task: WaypointFolderTask): string {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  if (task.kind === 'discussion') {
    const discussion = isRecord(runner.discussion) ? runner.discussion : {}
    if (typeof discussion.agent === 'string' && discussion.agent.trim()) return discussion.agent.trim()
    throw new Error(`Discussion task ${task.id} (${task.plan_ref}) is missing metadata.runner.discussion.agent`)
  }
  if (task.kind === 'recipe') {
    const recipe = isRecord(runner.recipe) ? runner.recipe : {}
    if (typeof recipe.slug === 'string' && recipe.slug.trim()) return recipe.slug.trim()
    throw new Error(`Recipe task ${task.id} (${task.plan_ref}) is missing metadata.runner.recipe.slug`)
  }
  throw new Error(`Task ${task.id} (${task.plan_ref}) of kind ${task.kind} is not executable as a Recipe`)
}

function isUnsupportedAutopilotTask(task: WaypointFolderTask): boolean {
  return task.kind === 'wait' || task.kind === 'delay' || task.kind === 'timer' || task.kind === 'dependency' || task.kind === 'system'
}

function mergeTaskMetadata(
  metadata: Record<string, unknown> | undefined,
  runnerPatch: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadata ?? {}
  const waypoint = isRecord(existing.runner) ? existing.runner : {}
  return { ...existing, runner: { ...waypoint, ...runnerPatch } }
}

function autopilotDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).runnerDir, 'autopilot')
}

function autopilotRunsPath(projectRoot: string): string {
  return join(autopilotDirectory(projectRoot), 'runs.jsonl')
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
