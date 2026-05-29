import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueCommentReader } from '../beads/cli-client.ts'
import { readWaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointRuntimeRoute, listWaypointRuntimeTasks, type WaypointRuntimeReadOptions } from '../routes/read-model.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'
import { readRouteEvents } from './jsonl.ts'
import type { ReadRouteEventsOptions, RouteEventPage, WaypointFolderRouteEvent } from './types.ts'

export interface WaypointRuntimeRouteEventOptions extends ReadRouteEventsOptions, WaypointRuntimeReadOptions {
  readonly beadsCommentReader?: WaypointBeadsIssueCommentReader
}

interface BeadsEventSource {
  readonly issueId: string
  readonly routeId: string
  readonly task?: WaypointFolderTask
}

export async function readWaypointRuntimeRouteEvents(
  projectRoot: string,
  routeId: string,
  options: WaypointRuntimeRouteEventOptions = {},
): Promise<RouteEventPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Route event limit must be a positive integer: ${limit}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`Route event offset must be a non-negative integer: ${offset}`)

  if ((await routeBackend(projectRoot)) === 'folder') return readRouteEvents(projectRoot, routeId, { limit, offset })

  const route = await getWaypointRuntimeRoute(projectRoot, routeId, { beadsReader: options.beadsReader })
  if (!route) throw new Error(`Route not found: ${routeId}`)
  const routeIssueId = beadsIssueId(route.metadata)
  if (!routeIssueId) throw new Error(`Beads route ${routeId} is missing issue metadata`)

  const tasks = await listWaypointRuntimeTasks(projectRoot, { routeId, beadsReader: options.beadsReader })
  const sources: BeadsEventSource[] = [
    { issueId: routeIssueId, routeId },
    ...tasks.flatMap((task): BeadsEventSource[] => {
      const issueId = beadsIssueId(task.metadata)
      return issueId ? [{ issueId, routeId, task }] : []
    }),
  ]

  const reader = options.beadsCommentReader ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  const commentEvents = (await Promise.all(sources.map((source) => eventsForBeadsIssue(reader, source)))).flat()
  const events = [
    routeStartedEvent(routeId, routeIssueId, route.created_at || route.updated_at),
    ...commentEvents,
  ].sort(compareEvents)

  return {
    items: events.slice(offset, offset + limit),
    total: events.length,
    limit,
    offset,
  }
}

async function eventsForBeadsIssue(
  reader: WaypointBeadsIssueCommentReader,
  source: BeadsEventSource,
): Promise<WaypointFolderRouteEvent[]> {
  const comments = await reader.listIssueComments(source.issueId)
  return comments.map((comment, index) => ({
    id: `beads-${source.issueId}-${comment.id || String(index + 1).padStart(3, '0')}`,
    route_id: source.routeId,
    kind: eventKindForBeadsComment(comment.text),
    created_at: comment.created_at ?? '',
    payload: {
      backend: 'beads',
      issue_id: source.issueId,
      ...(source.task ? { task_id: source.task.id, node: source.task.plan_ref, task_kind: source.task.kind, task_status: source.task.status } : {}),
      ...(comment.author ? { author: comment.author } : {}),
      text: comment.text,
    },
  }))
}

function routeStartedEvent(routeId: string, issueId: string, createdAt: string): WaypointFolderRouteEvent {
  return {
    id: `beads-${issueId}-route-started`,
    route_id: routeId,
    kind: 'route.started',
    created_at: createdAt,
    payload: {
      backend: 'beads',
      issue_id: issueId,
    },
  }
}

function eventKindForBeadsComment(text: string): string {
  if (text.startsWith('Waypoint route paused')) return 'route.paused'
  if (text.startsWith('Waypoint route resumed')) return 'route.resumed'
  if (text.startsWith('Waypoint gate approved')) return 'route.gate.approved'
  if (text.startsWith('Waypoint gate rejected')) return 'route.gate.rejected'
  if (text.startsWith('Waypoint blocker resolved')) return 'route.blocker.resolved'
  if (text.startsWith('Waypoint autopilot stopped') || text.startsWith('Waypoint autopilot recipe blocked')) {
    return 'route.autopilot.blocked'
  }
  if (text.startsWith('Waypoint autopilot completed') || text.startsWith('Waypoint autopilot executed') || text.startsWith('Waypoint autopilot simulated')) {
    return 'route.autopilot.completed'
  }
  if (text.startsWith('Waypoint discussion message')) return 'route.discussion.message'
  return 'route.issue.comment'
}

function beadsIssueId(metadata: unknown): string | null {
  const outer = isRecord(metadata) ? metadata : {}
  const beads = isRecord(outer.beads) ? outer.beads : {}
  return typeof beads.issue_id === 'string' ? beads.issue_id : null
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

function compareEvents(left: WaypointFolderRouteEvent, right: WaypointFolderRouteEvent): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
