import { stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

import { appendRouteEvent } from '../events/jsonl.ts'
import {
  approveWaypointBeadsRouteGate,
  pauseWaypointBeadsRoute,
  rejectWaypointBeadsRouteGate,
  resolveWaypointBeadsRouteBlocker,
  resumeWaypointBeadsRoute,
  type WaypointBeadsTransitionOptions,
} from '../beads/transitions.ts'
import { readWaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'

import { getWaypointRoute, updateWaypointRoute } from './store.ts'

import type { WaypointFolderTask } from '../tasks/types.ts'
import type { WaypointFolderRoute, WaypointFolderRouteStatus } from './types.ts'

export interface RouteGateDecisionInput extends WaypointBeadsTransitionOptions {
  readonly routeId: string
  readonly node: string
  readonly note?: string
  readonly nextNode?: string
  readonly now?: Date
}

export interface PauseWaypointRouteInput extends WaypointBeadsTransitionOptions {
  readonly routeId: string
  readonly reason?: string
  readonly now?: Date
}

export interface ResumeWaypointRouteInput extends WaypointBeadsTransitionOptions {
  readonly routeId: string
  readonly now?: Date
}

export interface ResolveWaypointRouteBlockerInput extends WaypointBeadsTransitionOptions {
  readonly routeId: string
  readonly note?: string
  readonly now?: Date
}

export async function approveRouteGate(projectRoot: string, input: RouteGateDecisionInput): Promise<WaypointFolderRoute> {
  if ((await routeBackend(projectRoot)) === 'beads') return approveWaypointBeadsRouteGate(projectRoot, input)

  const route = await requireRoute(projectRoot, input.routeId)
  await assertDecidesCurrentGate(projectRoot, route, input.node)
  const previousNode = route.current_node
  const nextNode = input.nextNode ?? route.current_node
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    current_node: nextNode,
    updated_at: timestampFor(input.now),
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.gate.approved',
    now: input.now,
    payload: {
      node: input.node,
      previous_node: previousNode,
      next_node: nextNode,
      ...(input.note ? { note: input.note } : {}),
    },
  })
  return updated
}

export async function rejectRouteGate(projectRoot: string, input: RouteGateDecisionInput): Promise<WaypointFolderRoute> {
  if ((await routeBackend(projectRoot)) === 'beads') return rejectWaypointBeadsRouteGate(projectRoot, input)

  const route = await requireRoute(projectRoot, input.routeId)
  await assertDecidesCurrentGate(projectRoot, route, input.node)
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'blocked',
    current_node: input.node,
    updated_at: timestampFor(input.now),
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.gate.rejected',
    now: input.now,
    payload: {
      node: input.node,
      previous_node: route.current_node,
      ...(input.note ? { note: input.note } : {}),
    },
  })
  return updated
}

export async function pauseWaypointRoute(projectRoot: string, input: PauseWaypointRouteInput): Promise<WaypointFolderRoute> {
  if ((await routeBackend(projectRoot)) === 'beads') return pauseWaypointBeadsRoute(projectRoot, input)

  const route = await requireRoute(projectRoot, input.routeId)
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'blocked',
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.paused',
    now: input.now,
    payload: {
      previous_status: route.status,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  })
  return updated
}

export async function resumeWaypointRoute(projectRoot: string, input: ResumeWaypointRouteInput): Promise<WaypointFolderRoute> {
  if ((await routeBackend(projectRoot)) === 'beads') return resumeWaypointBeadsRoute(projectRoot, input)

  const route = await requireRoute(projectRoot, input.routeId)
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.resumed',
    now: input.now,
    payload: { previous_status: route.status },
  })
  return updated
}

export async function resolveWaypointRouteBlocker(
  projectRoot: string,
  input: ResolveWaypointRouteBlockerInput,
): Promise<WaypointFolderRoute> {
  if ((await routeBackend(projectRoot)) === 'beads') return resolveWaypointBeadsRouteBlocker(projectRoot, input)

  const route = await requireRoute(projectRoot, input.routeId)
  const blockedTask = await currentBlockedTask(projectRoot, route)
  if (!blockedTask) throw new Error(`No blocked task found for route ${route.id}`)
  const missingArtifacts = await missingOutputArtifacts(projectRoot, blockedTask)
  if (missingArtifacts.length > 0) {
    throw new Error(`Missing required artifacts for ${blockedTask.plan_ref}: ${missingArtifacts.join(', ')}`)
  }

  const waypoint = isRecord(blockedTask.metadata?.waypoint) ? blockedTask.metadata.waypoint : {}
  const { missing_artifacts: _missingArtifacts, block_reason: _blockReason, ...cleanWaypoint } = waypoint
  await updateWaypointTask(projectRoot, blockedTask.id, {
    status: 'open',
    updated_at: timestampFor(input.now),
    metadata: { ...(blockedTask.metadata ?? {}), waypoint: cleanWaypoint },
  })
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    current_node: blockedTask.plan_ref,
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.blocker.resolved',
    now: input.now,
    payload: {
      task_id: blockedTask.id,
      node: blockedTask.plan_ref,
      previous_status: route.status,
      ...(input.note ? { note: input.note } : {}),
    },
  })
  return updated
}

async function routeBackend(projectRoot: string): Promise<WaypointRouteBackendMode> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return config.backend.route
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return 'folder'
    throw error
  }
}

async function requireRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute> {
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)
  return route
}

/**
 * The engine is the source of truth for gate decisions: the decision must target
 * the route's CURRENT node. A stale render, a replayed command, or a non-UI caller
 * must not decide a non-current gate (which would unblock the live route or block at
 * the wrong node). We validate against route.current_node — which startRoute sets and
 * gate transitions advance — independent of whether the gate task has reached
 * 'blocked' status yet (a gate can be decided while the route is still active).
 */
async function assertDecidesCurrentGate(
  projectRoot: string,
  route: WaypointFolderRoute,
  node: string,
): Promise<void> {
  // No current node → nothing to enforce against.
  if (route.current_node == null) return
  // Fast path: node matches current_node directly.
  if (node === route.current_node) return
  // Accept the id of the task sitting at current_node as an alternate identity.
  const tasks = await listWaypointTasks(projectRoot)
  const currentTask = tasks.find((t) => t.route_id === route.id && t.plan_ref === route.current_node)
  if (currentTask && node === currentTask.id) return
  throw new Error(`gate.decide: node "${node}" is not the current gate of route ${route.id}`)
}

async function currentBlockedTask(projectRoot: string, route: WaypointFolderRoute): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointTasks(projectRoot)
  return tasks.find((task) => task.route_id === route.id && task.status === 'blocked' && task.plan_ref === route.current_node) ??
    tasks.find((task) => task.route_id === route.id && task.status === 'blocked') ??
    null
}

async function missingOutputArtifacts(projectRoot: string, task: WaypointFolderTask): Promise<string[]> {
  const waypoint = isRecord(task.metadata?.waypoint) ? task.metadata.waypoint : {}
  const artifacts = Array.isArray(waypoint.output_artifacts)
    ? waypoint.output_artifacts.flatMap((artifact): string[] => {
        if (typeof artifact === 'string' && artifact.trim().length > 0) return [artifact]
        if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.trim().length > 0) return [artifact.path]
        return []
      })
    : []
  const missing: string[] = []
  for (const artifact of artifacts) {
    const safePath = safeRelativeArtifactPath(artifact)
    if (!safePath) {
      missing.push(artifact)
      continue
    }
    try {
      await stat(join(projectRoot, safePath))
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

function safeRelativeArtifactPath(artifact: string): string | null {
  const normalized = normalize(artifact.trim())
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) return null
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}
