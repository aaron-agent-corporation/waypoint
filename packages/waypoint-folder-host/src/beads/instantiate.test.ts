import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsDependencyCreateInput,
  type WaypointBeadsIssueClient,
  type WaypointBeadsIssueCreateInput,
} from './instantiate.ts'

describe('Waypoint Beads route instantiation adapter', () => {
  it('materializes a Quest route as Beads issues with parents, blockers, policies, and artifacts', async () => {
    const catalog = await loadBundledWaypointCatalog()
    const client = createRecordingClient()

    const result = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client,
    })

    expect(client.issueCreates[0]).toMatchObject({
      title: 'Referral Package',
      issueType: 'epic',
      metadata: {
        waypoint: {
          kind: 'route',
          quest_slug: 'referral-package',
          route_id: 'route-referral',
        },
      },
    })

    const chronology = result.issues.find((issue) => issue.logicalId === 'plan:medical-chronology-update')
    const chronologyCreate = client.issueCreates.find(
      (issue) => issue.metadata.waypoint.node_key === 'medical-chronology-update',
    )
    expect(chronologyCreate).toMatchObject({
      parent: result.root.beadsId,
      issueType: 'task',
      metadata: {
        waypoint: {
          kind: 'recipe',
          recipe_slug: 'firmvault-medical-chronology-update',
          policy: { external_side_effects: 'forbidden' },
        },
      },
    })
    expect(chronologyCreate?.metadata.waypoint.artifacts).toContainEqual({
      path: '03-medical/medical-chronology-output/medical-chronology.html',
      required: true,
      required_when: 'medical_records_present',
      verifier: {
        kind: 'required_paths',
        checks: ['exists', 'non_empty', 'directory_non_empty'],
      },
    })

    const startHere = result.issues.find((issue) => issue.logicalId === 'plan:start-here-draft')
    expect(client.dependencyCreates).toContainEqual({
      type: 'blocks',
      dependent: startHere?.beadsId,
      dependency: chronology?.beadsId,
    })
    expect(result.dependencies).toContainEqual({
      type: 'blocks',
      dependent: startHere?.beadsId,
      dependency: chronology?.beadsId,
      dependentLogicalId: 'plan:start-here-draft',
      dependencyLogicalId: 'plan:medical-chronology-update',
    })
  })

  it('preserves wait and checkpoint node kinds when instantiating routes', async () => {
    const catalog = await loadBundledWaypointCatalog()
    const client = createRecordingClient()

    const result = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'firmvault',
      routeId: 'route-firmvault',
      subject: { type: 'case', id: 'firmvault-fixture' },
      client,
    })

    const waitIssue = result.issues.find(
      (issue) => issue.spec.metadata.waypoint.node_key === 'firmvault-document-collection-wait-signed-documents',
    )
    expect(waitIssue?.spec.metadata.waypoint.kind).toBe('wait')

    const waypointClient = createRecordingClient()
    const waypointResult = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'waypoint',
      routeId: 'route-waypoint',
      subject: { type: 'project', id: 'local' },
      client: waypointClient,
    })
    const checkpointIssue = waypointResult.issues.find((issue) => issue.spec.metadata.waypoint.node_key === 'initialize-context')
    expect(checkpointIssue?.spec.metadata.waypoint.kind).toBe('checkpoint')

    expect(client.issueCreates.find((issue) => issue.metadata.waypoint.kind === 'wait')?.labels).toContain('waypoint-kind:wait')
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
