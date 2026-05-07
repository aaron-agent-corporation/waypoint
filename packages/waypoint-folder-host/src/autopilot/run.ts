import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { appendRouteEvent } from '../events/jsonl.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from '../routes/store.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'
import { NullRecipeRuntime } from '../runtime/null-runtime.ts'

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
  const routeId = options.routeId ?? (await defaultRouteId(projectRoot))
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(`Autopilot max iterations must be a positive integer: ${maxIterations}`)
  }

  const runtime = new NullRecipeRuntime()
  const completedTasks: string[] = []
  let iterations = 0
  let status: WaypointAutopilotRunStatus = 'complete'
  let blockedNode: string | null = null

  while (iterations < maxIterations) {
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

    const output = await runtime.runRecipe({
      routeId,
      taskId: nextTask.id,
      recipe: recipeForTask(nextTask),
      projectRoot,
    })
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
      kind: 'route.autopilot.task.simulated',
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

function recipeForTask(task: WaypointFolderTask): string {
  const waypoint = isRecord(task.metadata?.waypoint) ? task.metadata.waypoint : {}
  const discussion = isRecord(waypoint.discussion) ? waypoint.discussion : {}
  if (typeof discussion.agent === 'string') return discussion.agent
  return task.plan_ref
}

function mergeTaskMetadata(
  metadata: Record<string, unknown> | undefined,
  waypointPatch: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadata ?? {}
  const waypoint = isRecord(existing.waypoint) ? existing.waypoint : {}
  return { ...existing, waypoint: { ...waypoint, ...waypointPatch } }
}

function autopilotDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'autopilot')
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
