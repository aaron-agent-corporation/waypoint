import type { WaypointFolderRouteEvent } from './engine/types'

/**
 * Paused-provenance: a route is operator-paused iff the latest pause-relevant
 * lifecycle event is `route.paused` with no subsequent `route.resumed`. This is
 * independent of the route's (overloaded) `'blocked'` status and `current_node`.
 */
export function routeIsPaused(events: readonly WaypointFolderRouteEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const kind = events[i].kind
    if (kind === 'route.paused') return true
    if (kind === 'route.resumed') return false
  }
  return false
}
