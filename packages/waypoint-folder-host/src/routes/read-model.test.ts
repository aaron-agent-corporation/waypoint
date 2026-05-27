import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { instantiateWaypointRouteInBeads, type WaypointBeadsInstantiationResult, type WaypointBeadsIssueClient } from '../beads/instantiate'
import {
  type WaypointBeadsDependencySnapshot,
  type WaypointBeadsIssueSnapshot,
  type WaypointBeadsSnapshotStatus,
} from '../beads/reconstruct'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { readWaypointStatus } from '../project/status'
import { createWaypointRoute } from './store'
import { getWaypointRuntimeRoute, listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from './read-model'

describe('Waypoint route read model', () => {
  it('preserves folder route and task reads for folder-backed projects', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-read-model-folder-'))
    await initWaypointProject(projectRoot, { quest: 'waypoint' })
    await createWaypointRoute(projectRoot, {
      id: 'route-123',
      quest: 'waypoint',
      subject: { type: 'project', id: 'local' },
      current_node: 'initialize',
    })

    await expect(listWaypointRuntimeRoutes(projectRoot)).resolves.toMatchObject([
      { id: 'route-123', quest: 'waypoint', current_node: 'initialize' },
    ])
  })

  it('reconstructs Beads-backed routes, tasks, blockers, and status summaries from issue snapshots', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-read-model-beads-'))
    await initWaypointProject(projectRoot, { quest: 'referral-package', backend: 'beads' })
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingClient(),
    })
    const beadsReader = {
      async listIssueSnapshots() {
        return snapshotFromInstantiation(instantiated)
      },
    }

    const routes = await listWaypointRuntimeRoutes(projectRoot, { beadsReader })
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      id: 'route-referral',
      quest: 'referral-package',
      status: 'active',
      current_node: 'source-inventory',
      metadata: {
        backend: { route: 'beads' },
        beads: {
          issue_id: 'bd-001',
          progress: {
            total: 12,
            blocked: 10,
            ready: 2,
          },
        },
      },
    })

    await expect(getWaypointRuntimeRoute(projectRoot, 'route-referral', { beadsReader })).resolves.toMatchObject({
      id: 'route-referral',
      status: 'active',
    })
    await expect(getWaypointRuntimeRoute(projectRoot, 'missing-route', { beadsReader })).resolves.toBeNull()

    const tasks = await listWaypointRuntimeTasks(projectRoot, { routeId: 'route-referral', beadsReader })
    expect(tasks).toHaveLength(12)
    expect(tasks.find((task) => task.plan_ref === 'start-here-draft')).toMatchObject({
      id: 'bd-009',
      status: 'blocked',
      kind: 'recipe',
      metadata: {
        beads: {
          blockers: ['bd-007', 'bd-008'],
        },
      },
    })

    await expect(readWaypointStatus(projectRoot, {
      beadsReader,
      beadsWorkspace: { runner: readyBeadsWorkspaceRunner(projectRoot) },
    })).resolves.toMatchObject({
      backend: 'beads',
      routes: {
        total: 1,
        active: 1,
        blocked: 0,
      },
    })
  })
})

function readyBeadsWorkspaceRunner(projectRoot: string) {
  return {
    async run() {
      return {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({ path: `${projectRoot}/.beads`, prefix: 'waypoint' }),
        stderr: '',
      }
    },
  }
}

function snapshotFromInstantiation(
  result: WaypointBeadsInstantiationResult,
  statuses: Record<string, WaypointBeadsSnapshotStatus> = {},
): {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
} {
  return {
    issues: result.issues.map((issue, index) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: statuses[issue.logicalId] ?? 'open',
      issue_type: issue.spec.issueType,
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:00:00.000Z',
      metadata: index % 2 === 0 ? issue.spec.metadata : JSON.stringify(issue.spec.metadata),
      ...(issue.spec.parent ? { parent: result.root.beadsId } : {}),
      dependencies: result.dependencies
        .filter((dependency) => dependency.dependent === issue.beadsId)
        .map((dependency) => ({
          issue_id: dependency.dependent,
          depends_on_id: dependency.dependency,
          type: dependency.type,
        })),
    })),
    dependencies: result.dependencies.map((dependency) => ({
      issue_id: dependency.dependent,
      depends_on_id: dependency.dependency,
      type: dependency.type,
    })),
  }
}

function createRecordingClient(): WaypointBeadsIssueClient {
  let count = 0
  return {
    async createIssue() {
      count += 1
      return { id: `bd-${String(count).padStart(3, '0')}` }
    },
    async addDependency() {
      return undefined
    },
  }
}
