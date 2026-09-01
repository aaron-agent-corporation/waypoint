import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import { PostgresTestProjects } from '../testing/postgres'
import { createWaypointRoute, getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from './store'

const pgProjects = new PostgresTestProjects()

async function tempProject(): Promise<string> {
  const projectRoot = await pgProjects.mkProjectRoot('runner-routes-')
  await initWaypointProject(projectRoot, { quest: 'runner' })
  return projectRoot
}

describe('postgres route store', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('creates route records with deterministic ids and persists them', async () => {
    const projectRoot = await tempProject()

    const route = await createWaypointRoute(projectRoot, {
      quest: 'runner',
      subject: { type: 'project', id: 'project' },
      current_node: 'initialize',
      now: new Date('2026-05-07T13:30:00.000Z'),
    })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'runner',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'project' },
    })

    // The record round-trips through the store: what get returns is what
    // create persisted, timestamps included.
    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({
      id: 'route-001',
      quest: 'runner',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'project' },
      created_at: '2026-05-07T13:30:00.000Z',
      updated_at: '2026-05-07T13:30:00.000Z',
    })

    const second = await createWaypointRoute(projectRoot, {
      quest: 'debug',
      subject: { type: 'project', id: 'project' },
      current_node: 'inspect',
    })
    expect(second.id).toBe('route-002')

    const routes = await listWaypointRoutes(projectRoot)
    expect(routes.map((entry) => entry.id)).toEqual(['route-001', 'route-002'])
  })

  it('updates route records in place and persists the patch', async () => {
    const projectRoot = await tempProject()
    await createWaypointRoute(projectRoot, {
      quest: 'runner',
      subject: { type: 'project', id: 'project' },
      current_node: 'initialize',
      now: new Date('2026-05-07T13:30:00.000Z'),
    })

    const updated = await updateWaypointRoute(projectRoot, 'route-001', {
      status: 'blocked',
      current_node: 'plan-approval-gate',
      updated_at: '2026-05-07T13:45:00.000Z',
    })

    expect(updated).toMatchObject({
      id: 'route-001',
      status: 'blocked',
      current_node: 'plan-approval-gate',
      created_at: '2026-05-07T13:30:00.000Z',
      updated_at: '2026-05-07T13:45:00.000Z',
    })
    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({
      status: 'blocked',
      current_node: 'plan-approval-gate',
      updated_at: '2026-05-07T13:45:00.000Z',
    })
  })

  it('getWaypointRoute returns null for an unknown route id', async () => {
    const projectRoot = await tempProject()
    expect(await getWaypointRoute(projectRoot, 'route-999')).toBeNull()
  })
})
