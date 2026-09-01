import { readRouteEvents } from './jsonl.ts'
import type { ReadRouteEventsOptions, RouteEventPage } from './types.ts'

export type WaypointRuntimeRouteEventOptions = ReadRouteEventsOptions

export async function readWaypointRuntimeRouteEvents(
  projectRoot: string,
  routeId: string,
  options: WaypointRuntimeRouteEventOptions = {},
): Promise<RouteEventPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Route event limit must be a positive integer: ${limit}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`Route event offset must be a non-negative integer: ${offset}`)

  // folder and postgres share the store-backed event log.
  return readRouteEvents(projectRoot, routeId, { limit, offset })
}
