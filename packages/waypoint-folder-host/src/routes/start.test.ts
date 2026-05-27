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
import { listWaypointTasks } from '../tasks/store'
import type {
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
} from '../beads/instantiate'
import type { WaypointBeadsCliCommandRunner } from '../beads/cli-client'
import { getWaypointRoute, listWaypointRoutes } from './store'
import { startQuestRoute } from './start'

async function tempProject(backend: 'folder' | 'beads' = 'folder'): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-start-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint', backend })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  return projectRoot
}

describe('startQuestRoute', () => {
  it('scaffolds the selected Quest lifecycle idempotently', async () => {
    const projectRoot = await tempProject()

    await startQuestRoute(projectRoot, { quest: 'waypoint' })
    await startQuestRoute(projectRoot, { quest: 'waypoint' })

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

    const route = await startQuestRoute(projectRoot, { quest: 'waypoint' })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'waypoint',
      backend: 'folder',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'local' },
    })

    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({ id: 'route-001', quest: 'waypoint' })
    expect((await listWaypointRoutes(projectRoot)).map((entry) => entry.id)).toEqual(['route-001'])

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.total).toBe(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.started',
      payload: {
        quest: 'waypoint',
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

  it('materializes a Beads-backed route graph when the route backend is beads', async () => {
    const projectRoot = await tempProject('beads')
    const client = createRecordingClient()

    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: client })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'waypoint',
      backend: 'beads',
      beads: {
        root_issue_id: 'bd-001',
      },
    })
    expect(client.issueCreates[0]).toMatchObject({
      issueType: 'epic',
      metadata: {
        waypoint: {
          kind: 'route',
          quest_slug: 'waypoint',
          route_id: 'route-001',
        },
      },
    })
    expect(client.issueCreates.length).toBe(routeIssueCountForWaypointQuest())
    expect(client.dependencyCreates.length).toBeGreaterThan(1)
    expect(await listWaypointTasks(projectRoot)).toEqual([])

    const savedRoute = await getWaypointRoute(projectRoot, 'route-001')
    expect(savedRoute?.metadata).toMatchObject({
      backend: { route: 'beads' },
      beads: {
        root_issue_id: 'bd-001',
        issue_count: client.issueCreates.length,
        dependency_count: client.dependencyCreates.length,
      },
    })

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items[0]).toMatchObject({
      kind: 'route.started',
      payload: {
        backend: 'beads',
        beads: {
          root_issue_id: 'bd-001',
        },
      },
    })
  })

  it('fails with an actionable readiness message before writing a Beads graph when the workspace is missing', async () => {
    const projectRoot = await tempProject('beads')
    const runner: WaypointBeadsCliCommandRunner = {
      async run() {
        return {
          exitCode: 1,
          signal: null,
          stdout: JSON.stringify({
            error: 'no_beads_directory',
            message: 'No active beads workspace found.',
          }),
          stderr: '',
        }
      },
    }

    await expect(startQuestRoute(projectRoot, { quest: 'waypoint', beadsWorkspace: { runner } })).rejects.toThrow(
      'Run waypoint init --backend beads --init-beads',
    )
    expect(await listWaypointRoutes(projectRoot)).toEqual([])
  })

  it('fails safely instead of duplicating an existing Beads route graph', async () => {
    const projectRoot = await tempProject('beads')
    const client = createRecordingClient()

    await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: client })

    await expect(startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: client })).rejects.toThrow(
      'Beads route already started for quest waypoint: route-001',
    )
    expect(client.issueCreates.length).toBe(routeIssueCountForWaypointQuest())
  })
})

function createRecordingClient(): WaypointBeadsIssueClient & {
  readonly issueCreates: WaypointBeadsIssueCreateInput[]
  readonly dependencyCreates: WaypointBeadsDependencyCreateInput[]
} {
  const issueCreates: WaypointBeadsIssueCreateInput[] = []
  const dependencyCreates: WaypointBeadsDependencyCreateInput[] = []
  return {
    issueCreates,
    dependencyCreates,
    async createIssue(input) {
      issueCreates.push(input)
      return { id: `bd-${String(issueCreates.length).padStart(3, '0')}` }
    },
    async addDependency(input) {
      dependencyCreates.push(input)
    },
  }
}

function routeIssueCountForWaypointQuest(): number {
  return 13
}
