import { describe, expect, it } from 'vitest'

import { routeIsPaused } from './routeStatus'
import type { WaypointFolderRouteEvent } from './engine/types'

const ev = (kind: string, id: number): WaypointFolderRouteEvent => ({ id: String(id), route_id: 'r1', kind, created_at: `t${id}` } as WaypointFolderRouteEvent)

describe('routeIsPaused', () => {
  it('is true when the latest pause-relevant event is route.paused', () => {
    expect(routeIsPaused([ev('route.started', 1), ev('route.paused', 2)])).toBe(true)
  })
  it('is false when a route.resumed follows the pause', () => {
    expect(routeIsPaused([ev('route.paused', 1), ev('route.resumed', 2)])).toBe(false)
  })
  it('is false with no pause events', () => {
    expect(routeIsPaused([ev('route.started', 1)])).toBe(false)
    expect(routeIsPaused([])).toBe(false)
  })
  it('uses the LAST pause-relevant event when several exist', () => {
    expect(routeIsPaused([ev('route.paused', 1), ev('route.resumed', 2), ev('route.paused', 3)])).toBe(true)
  })
})
