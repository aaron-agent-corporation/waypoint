import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { readRouteEvents } from '../events/jsonl'
import { listLifecycleState } from '../lifecycle/store'
import { initWaypointProject } from '../project/init'
import { PostgresTestProjects } from '../testing/postgres'
import { getWaypointRoute, listWaypointRoutes } from './store'
import { startQuestRoute } from './start'

const pgProjects = new PostgresTestProjects()

async function tempProject(): Promise<string> {
  const projectRoot = await pgProjects.mkProjectRoot('runner-start-')
  // Plain postgres (durable: false): these tests exercise the non-durable
  // start path, where the store materializes state and nothing advances it.
  await initWaypointProject(projectRoot, { quest: 'runner', postgres: { durable: false }, runtime: { recipe: 'null' } })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'runner' })
  return projectRoot
}

describe('startQuestRoute', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('scaffolds the selected Quest lifecycle idempotently', async () => {
    const projectRoot = await tempProject()

    await startQuestRoute(projectRoot, { quest: 'runner' })
    await startQuestRoute(projectRoot, { quest: 'runner' })

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

    // Lifecycle scaffold is authored content and stays on disk (P5).
    const phases = yamlParse(await readFile(join(projectRoot, '.waypoint/lifecycle/phases.yaml'), 'utf8')) as {
      phases: Array<Record<string, unknown>>
    }
    expect(phases.phases[0]).toMatchObject({ key: 'initialize', milestone: 'v1', lifecycle: 'initialize' })
  })

  it('refuses a Quest marked not-yet-available, before any route rows exist (D5)', async () => {
    const projectRoot = await tempProject()
    const questPath = join(projectRoot, '.waypoint/quests/runner.yaml')
    const manifest = yamlParse(await readFile(questPath, 'utf8')) as Record<string, unknown>
    const metadata = (manifest.metadata ?? {}) as Record<string, unknown>
    const waypoint = (metadata.runner ?? {}) as Record<string, unknown>
    manifest.metadata = { ...metadata, runner: { ...waypoint, availability: 'not_yet_available' } }
    await writeFile(questPath, yamlStringify(manifest), 'utf8')

    await expect(startQuestRoute(projectRoot, { quest: 'runner' })).rejects.toThrow(
      /Quest 'runner' is not yet available/,
    )
    // Nothing was materialized: the refusal is at the door, not a rollback.
    expect(await listWaypointRoutes(projectRoot)).toEqual([])
  })

  it('refuses an availability value it does not recognize — the fallback is guarded, not reassuring', async () => {
    const projectRoot = await tempProject()
    const questPath = join(projectRoot, '.waypoint/quests/runner.yaml')
    const manifest = yamlParse(await readFile(questPath, 'utf8')) as Record<string, unknown>
    const metadata = (manifest.metadata ?? {}) as Record<string, unknown>
    const waypoint = (metadata.runner ?? {}) as Record<string, unknown>
    manifest.metadata = { ...metadata, runner: { ...waypoint, availability: 'probably fine' } }
    await writeFile(questPath, yamlStringify(manifest), 'utf8')

    await expect(startQuestRoute(projectRoot, { quest: 'runner' })).rejects.toThrow(/is not yet available/)
  })

  it('creates a route and appends a route.started event', async () => {
    const projectRoot = await tempProject()

    const route = await startQuestRoute(projectRoot, { quest: 'runner' })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'runner',
      backend: 'postgres',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'local' },
    })

    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({ id: 'route-001', quest: 'runner' })
    expect((await listWaypointRoutes(projectRoot)).map((entry) => entry.id)).toEqual(['route-001'])

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.total).toBe(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: {
        quest: 'runner',
        // One recipe since D6 (2026-08-24): the discuss step's conversation agent.
        recipes: 1,
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
