import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'

import type { AppendRouteEventInput, ReadRouteEventsOptions, RouteEventPage, WaypointFolderRouteEvent } from './types.ts'

export async function appendRouteEvent(
  projectRoot: string,
  routeId: string,
  input: AppendRouteEventInput,
): Promise<WaypointFolderRouteEvent> {
  const existing = await readAllRouteEvents(projectRoot, routeId)
  const event: WaypointFolderRouteEvent = {
    id: nextEventId(existing.length),
    route_id: routeId,
    kind: input.kind,
    created_at: timestampFor(input.now),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  }

  const eventsDir = eventsDirectory(projectRoot)
  await mkdir(eventsDir, { recursive: true })
  await appendFile(routeEventsFilePath(projectRoot, routeId), `${JSON.stringify(event)}\n`, 'utf8')
  return event
}

export async function readRouteEvents(
  projectRoot: string,
  routeId: string,
  options: ReadRouteEventsOptions = {},
): Promise<RouteEventPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Route event limit must be a positive integer: ${limit}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Route event offset must be a non-negative integer: ${offset}`)
  }

  const events = await readAllRouteEvents(projectRoot, routeId)
  return {
    items: events.slice(offset, offset + limit),
    total: events.length,
    limit,
    offset,
  }
}

async function readAllRouteEvents(projectRoot: string, routeId: string): Promise<WaypointFolderRouteEvent[]> {
  let raw: string
  try {
    raw = await readFile(routeEventsFilePath(projectRoot, routeId), 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WaypointFolderRouteEvent)
}

function eventsDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'events')
}

function routeEventsFilePath(projectRoot: string, routeId: string): string {
  return join(eventsDirectory(projectRoot), `${routeId}.jsonl`)
}

function nextEventId(existingCount: number): string {
  return `event-${String(existingCount + 1).padStart(3, '0')}`
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
