import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { appendRouteEvent, readRouteEvents } from '../events/jsonl'
import { createWaypointRoute, getWaypointRoute } from './store'
import { approveRouteGate, pauseWaypointRoute, rejectRouteGate, resumeWaypointRoute } from './state'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-route-state-'))
}

async function createRoute(projectRoot: string) {
  return createWaypointRoute(projectRoot, {
    quest: 'gsd',
    current_node: 'human_plan_gate',
    subject: { type: 'project', id: 'local' },
    now: new Date('2026-05-07T16:30:00.000Z'),
  })
}

describe('route state controls', () => {
  it('approves a gate, advances the current node, and appends an event', async () => {
    const projectRoot = await tempProject()
    const route = await createRoute(projectRoot)

    const updated = await approveRouteGate(projectRoot, {
      routeId: route.id,
      node: 'human_plan_gate',
      note: 'Plan accepted',
      nextNode: 'execute',
      now: new Date('2026-05-07T16:31:00.000Z'),
    })

    expect(updated).toMatchObject({ id: 'route-001', status: 'active', current_node: 'execute' })
    expect(await getWaypointRoute(projectRoot, route.id)).toMatchObject({ status: 'active', current_node: 'execute' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items).toHaveLength(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.gate.approved',
      payload: { node: 'human_plan_gate', note: 'Plan accepted', previous_node: 'human_plan_gate', next_node: 'execute' },
    })
  })

  it('rejects a gate, blocks the route, and records the note', async () => {
    const projectRoot = await tempProject()
    const route = await createRoute(projectRoot)

    const updated = await rejectRouteGate(projectRoot, {
      routeId: route.id,
      node: 'human_plan_gate',
      note: 'Plan needs work',
      now: new Date('2026-05-07T16:32:00.000Z'),
    })

    expect(updated).toMatchObject({ id: 'route-001', status: 'blocked', current_node: 'human_plan_gate' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items[0]).toMatchObject({
      kind: 'route.gate.rejected',
      payload: { node: 'human_plan_gate', note: 'Plan needs work', previous_node: 'human_plan_gate' },
    })
  })

  it('pauses and resumes a route with append-only events', async () => {
    const projectRoot = await tempProject()
    const route = await createRoute(projectRoot)
    await appendRouteEvent(projectRoot, route.id, { kind: 'route.started', now: new Date('2026-05-07T16:30:01.000Z') })

    await pauseWaypointRoute(projectRoot, {
      routeId: route.id,
      reason: 'Waiting on review',
      now: new Date('2026-05-07T16:33:00.000Z'),
    })
    const resumed = await resumeWaypointRoute(projectRoot, {
      routeId: route.id,
      now: new Date('2026-05-07T16:34:00.000Z'),
    })

    expect(resumed).toMatchObject({ id: 'route-001', status: 'active' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.map((event) => event.kind)).toEqual(['route.started', 'route.paused', 'route.resumed'])
    expect(events.items[1]).toMatchObject({ payload: { reason: 'Waiting on review', previous_status: 'active' } })
    expect(events.items[2]).toMatchObject({ payload: { previous_status: 'blocked' } })
  })
})
