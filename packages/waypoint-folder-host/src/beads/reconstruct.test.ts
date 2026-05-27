import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsDependencyCreateInput,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
  type WaypointBeadsIssueCreateInput,
} from './instantiate.ts'
import {
  reconstructWaypointRunFromBeads,
  type WaypointBeadsDependencySnapshot,
  type WaypointBeadsIssueSnapshot,
  type WaypointBeadsSnapshotStatus,
} from './reconstruct.ts'

describe('Waypoint Beads run reconstruction', () => {
  it('derives route progress and blocked task state from Beads issues and blockers', async () => {
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingClient(),
    })

    const reconstructed = reconstructWaypointRunFromBeads(snapshotFromInstantiation(instantiated))

    expect(reconstructed.route).toMatchObject({
      id: 'route-referral',
      beads_id: 'bd-001',
      quest: 'referral-package',
      status: 'active',
      current_node: 'source-inventory',
      progress: {
        total: 12,
        open: 2,
        blocked: 10,
        ready: 2,
      },
    })

    expect(reconstructed.tasks.find((task) => task.plan_ref === 'start-here-draft')).toMatchObject({
      status: 'blocked',
      blockers: ['bd-007', 'bd-008'],
      kind: 'recipe',
      wave: 4,
      sequence: 8,
    })
  })

  it('treats human gates and waits as blocked route states when they are the only ready work', async () => {
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingClient(),
    })
    const statuses: Record<string, WaypointBeadsSnapshotStatus> = Object.fromEntries(
      instantiated.issues.map((issue) => [issue.logicalId, 'closed']),
    )
    statuses['route:referral-package'] = 'open'
    statuses['plan:attorney-handoff-gate'] = 'open'
    statuses['plan:handoff-ready-summary'] = 'open'

    const reconstructed = reconstructWaypointRunFromBeads(snapshotFromInstantiation(instantiated, statuses))

    expect(reconstructed.route).toMatchObject({
      status: 'blocked',
      current_node: 'attorney-handoff-gate',
      progress: {
        done: 10,
        open: 1,
        blocked: 1,
        ready: 1,
      },
    })
    expect(reconstructed.tasks.find((task) => task.plan_ref === 'handoff-ready-summary')).toMatchObject({
      status: 'blocked',
      blockers: [reconstructed.tasks.find((task) => task.plan_ref === 'attorney-handoff-gate')?.beads_id],
    })
  })
})

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
    })),
    dependencies: result.dependencies.map((dependency) => ({
      issue_id: dependency.dependent,
      depends_on_id: dependency.dependency,
      type: dependency.type,
    })),
  }
}

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
