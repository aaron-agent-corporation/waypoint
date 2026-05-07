import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import { createRouteEventBus } from './event-bus'
import { appendRouteEvent, readRouteEvents } from './jsonl'

async function tempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-events-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint' })
  return projectRoot
}

describe('folder route JSONL events', () => {
  it('appends and reads route events with pagination', async () => {
    const projectRoot = await tempProject()

    const first = await appendRouteEvent(projectRoot, 'route-001', {
      kind: 'route.started',
      payload: { quest: 'waypoint' },
      now: new Date('2026-05-07T13:31:00.000Z'),
    })
    await appendRouteEvent(projectRoot, 'route-001', {
      kind: 'route.node.entered',
      payload: { node: 'initialize' },
      now: new Date('2026-05-07T13:32:00.000Z'),
    })

    expect(first).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: { quest: 'waypoint' },
      created_at: '2026-05-07T13:31:00.000Z',
    })

    const raw = await readFile(join(projectRoot, '.waypoint/events/route-001.jsonl'), 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'event-001', kind: 'route.started' })

    const page = await readRouteEvents(projectRoot, 'route-001', { limit: 1, offset: 1 })
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: 'event-002', kind: 'route.node.entered' })
  })

  it('publishes events through an append-only event bus adapter', async () => {
    const projectRoot = await tempProject()
    const bus = createRouteEventBus(projectRoot, 'route-001')

    await bus.publish({ type: 'route.started', timestamp: 1778160720, payload: { quest: 'waypoint' } })

    const events = await readRouteEvents(projectRoot, 'route-001')
    expect(events.items).toHaveLength(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: { quest: 'waypoint' },
    })
  })
})
