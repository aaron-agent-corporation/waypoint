import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import type { EngineEvent } from '../types.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host run/watch commands (folder)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('starts a route, lists it, and broadcasts live events from the durable log', async () => {
    const received: EngineEvent[] = []
    host.hub.subscribe({ topics: '*', deliver: (e) => received.push(e), requestResnapshot: () => {} })

    const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as {
      ok: boolean
      route: { id: string; quest: string; status: string }
    }
    expect(started.ok).toBe(true)
    expect(started.route).toMatchObject({ quest: 'waypoint', status: 'active' })

    const routes = (await host.dispatch('routes.list', {})) as unknown as { routes: unknown[] }
    expect(routes.routes).toHaveLength(1)

    const got = (await host.dispatch('route.get', { routeId: started.route.id })) as unknown as {
      ok: boolean
      route: { id: string }
    }
    expect(got.route.id).toBe(started.route.id)

    const tasks = (await host.dispatch('tasks.list', { routeId: started.route.id })) as unknown as { ok: boolean }
    expect(tasks.ok).toBe(true)

    const events = (await host.dispatch('route.events', { routeId: started.route.id })) as unknown as {
      events: unknown[]
      total: number
      limit: number
      offset: number
    }
    expect(events.events.length).toBeGreaterThan(0)
    expect(events).toMatchObject({ total: expect.any(Number), limit: expect.any(Number), offset: expect.any(Number) })

    // RouteBroadcaster fed the hub from the durable log on run.start.
    expect(received.length).toBeGreaterThan(0)

    // B1: pin the two-call paging contract the UI depends on.
    // Pause + resume to append two more events (route.paused, route.resumed) so the
    // log has ≥3 entries; then limit=1 proves total > page, and limit=total proves
    // the full log is retrievable in one call.
    const routeId = started.route.id
    await host.dispatch('run.pause', { routeId, reason: 'b1-test' })
    await host.dispatch('run.resume', { routeId })

    const small = (await host.dispatch('route.events', { routeId, limit: 1 })) as unknown as {
      events: unknown[]
      total: number
      limit: number
      offset: number
    }
    expect(small.events).toHaveLength(1)
    expect(small.total).toBeGreaterThan(small.events.length) // true count exceeds the page

    const full = (await host.dispatch('route.events', { routeId, limit: small.total })) as unknown as {
      events: unknown[]
      total: number
    }
    expect(full.events).toHaveLength(small.total) // second call returns the complete log
    expect(full.total).toBe(small.total)
  })

  it('route.get returns NOT_FOUND for an unknown route', async () => {
    expect(await host.dispatch('route.get', { routeId: 'route-999' })).toMatchObject({
      ok: false,
      action: 'error',
      details: { code: 'NOT_FOUND' },
    })
  })

  it('pauses and resumes a route', async () => {
    const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as { route: { id: string } }
    const routeId = started.route.id
    // folder-host pause marks the route 'blocked' (paused state); resume → 'active'.
    expect(await host.dispatch('run.pause', { routeId, reason: 'lunch' })).toMatchObject({
      ok: true,
      action: 'run.pause',
      route: { status: 'blocked' },
    })
    expect(await host.dispatch('run.resume', { routeId })).toMatchObject({
      ok: true,
      action: 'run.resume',
      route: { status: 'active' },
    })
  })

  it('does not double-broadcast the same event across repeated emits (ID-diff dedup)', async () => {
    const received: EngineEvent[] = []
    host.hub.subscribe({ topics: '*', deliver: (e) => received.push(e), requestResnapshot: () => {} })
    const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as { route: { id: string } }
    const afterStart = received.length
    expect(afterStart).toBeGreaterThan(0)
    // A redundant emit (as the poll tick would do) must broadcast nothing new.
    await host.broadcaster.emit(started.route.id)
    expect(received.length).toBe(afterStart)
  })

  it('requires a quest for run.start', async () => {
    expect(await host.dispatch('run.start', {})).toMatchObject({
      ok: false,
      action: 'error',
      details: { code: 'VALIDATION', path: 'quest' },
    })
  })
})
