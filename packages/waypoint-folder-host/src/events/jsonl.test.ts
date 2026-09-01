import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import { PostgresTestProjects } from '../testing/postgres'
import { createRouteEventBus } from './event-bus'
import { appendRouteEvent, readRouteEvents } from './jsonl'

const pgProjects = new PostgresTestProjects()

async function tempProject(): Promise<string> {
  const projectRoot = await pgProjects.mkProjectRoot('runner-events-')
  await initWaypointProject(projectRoot, { quest: 'runner' })
  return projectRoot
}

describe('postgres route events', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('appends and reads route events with pagination', async () => {
    const projectRoot = await tempProject()

    const first = await appendRouteEvent(projectRoot, 'route-001', {
      kind: 'route.started',
      payload: { quest: 'runner' },
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
      payload: { quest: 'runner' },
      created_at: '2026-05-07T13:31:00.000Z',
    })

    // Both events persisted in append order with count-derived ids.
    const all = await readRouteEvents(projectRoot, 'route-001')
    expect(all.total).toBe(2)
    expect(all.items.map((event) => event.id)).toEqual(['event-001', 'event-002'])
    expect(all.items[0]).toMatchObject({ id: 'event-001', kind: 'route.started' })

    const page = await readRouteEvents(projectRoot, 'route-001', { limit: 1, offset: 1 })
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: 'event-002', kind: 'route.node.entered' })
  })

  it('rejects invalid limit/offset paging options', async () => {
    const projectRoot = await tempProject()

    await expect(readRouteEvents(projectRoot, 'route-001', { limit: 0 })).rejects.toThrow(
      /Route event limit must be a positive integer/,
    )
    await expect(readRouteEvents(projectRoot, 'route-001', { limit: 1.5 })).rejects.toThrow(
      /Route event limit must be a positive integer/,
    )
    await expect(readRouteEvents(projectRoot, 'route-001', { offset: -1 })).rejects.toThrow(
      /Route event offset must be a non-negative integer/,
    )
  })

  it('publishes events through an append-only event bus adapter', async () => {
    const projectRoot = await tempProject()
    const bus = createRouteEventBus(projectRoot, 'route-001')

    await bus.publish({ type: 'route.started', timestamp: 1778160720, payload: { quest: 'runner' } })

    const events = await readRouteEvents(projectRoot, 'route-001')
    expect(events.items).toHaveLength(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: { quest: 'runner' },
    })
  })
})
