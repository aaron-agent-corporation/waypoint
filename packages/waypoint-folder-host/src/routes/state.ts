import { appendRouteEvent } from '../events/jsonl.ts'

import { getWaypointRoute, updateWaypointRoute } from './store.ts'

import type { WaypointFolderRoute, WaypointFolderRouteStatus } from './types.ts'

export interface RouteGateDecisionInput {
  readonly routeId: string
  readonly node: string
  readonly note?: string
  readonly nextNode?: string
  readonly now?: Date
}

export interface PauseWaypointRouteInput {
  readonly routeId: string
  readonly reason?: string
  readonly now?: Date
}

export interface ResumeWaypointRouteInput {
  readonly routeId: string
  readonly now?: Date
}

export async function approveRouteGate(projectRoot: string, input: RouteGateDecisionInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
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
  const route = await requireRoute(projectRoot, input.routeId)
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

async function requireRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute> {
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)
  return route
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}
