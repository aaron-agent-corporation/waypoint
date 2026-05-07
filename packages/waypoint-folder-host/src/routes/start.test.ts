import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { readRouteEvents } from '../events/jsonl'
import { listLifecycleState } from '../lifecycle/store'
import { initWaypointProject } from '../project/init'
import { getWaypointRoute, listWaypointRoutes } from './store'
import { startQuestRoute } from './start'

async function tempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-start-'))
  await initWaypointProject(projectRoot, { quest: 'gsd' })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'gsd' })
  return projectRoot
}

describe('startQuestRoute', () => {
  it('scaffolds the selected Quest lifecycle idempotently', async () => {
    const projectRoot = await tempProject()

    await startQuestRoute(projectRoot, { quest: 'gsd' })
    await startQuestRoute(projectRoot, { quest: 'gsd' })

    const state = await listLifecycleState(projectRoot)
    expect(state.workstreams.map((entry) => entry.key)).toEqual(['delivery'])
    expect(state.milestones.map((entry) => entry.key)).toEqual(['v1'])
    expect(state.phases.map((entry) => entry.key)).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])
    expect(state.plans.map((entry) => entry.ref)).toEqual([
      'initialize-context',
      'initialize-roadmap',
      'discuss-objective',
      'discuss-assumptions',
      'plan-research',
      'plan-approval-gate',
      'execute-slice',
      'execute-checkpoint',
      'verify-work',
      'verify-approval-gate',
      'ship-prep',
      'ship-approval-gate',
    ])

    const phases = yamlParse(await readFile(join(projectRoot, '.waypoint/lifecycle/phases.yaml'), 'utf8')) as {
      phases: Array<Record<string, unknown>>
    }
    expect(phases.phases[0]).toMatchObject({ key: 'initialize', milestone: 'v1', lifecycle: 'initialize' })
  })

  it('creates a route and appends a route.started event', async () => {
    const projectRoot = await tempProject()

    const route = await startQuestRoute(projectRoot, { quest: 'gsd' })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'gsd',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'local' },
    })

    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({ id: 'route-001', quest: 'gsd' })
    expect((await listWaypointRoutes(projectRoot)).map((entry) => entry.id)).toEqual(['route-001'])

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.total).toBe(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: {
        quest: 'gsd',
        recipes: 12,
        lifecycle: {
          workstreams: 1,
          milestones: 1,
          phases: 6,
          plans: 12,
        },
      },
    })
  })
})
