import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
} from './instantiate.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsRunTask, type WaypointBeadsSnapshotStatus } from './reconstruct.ts'
import { verifyWaypointBeadsTaskCompletion, type WaypointBeadsArtifactVerifier } from './verification.ts'

describe('Waypoint Beads task completion verification', () => {
  it('keeps human gates blocked until an explicit approval is supplied', async () => {
    const gate = await readyTaskForQuest('referral-package', 'plan:attorney-handoff-gate')

    await expect(verifyWaypointBeadsTaskCompletion(gate)).resolves.toMatchObject({
      action: 'block_close',
      block_reasons: ['human_review_required'],
    })

    await expect(verifyWaypointBeadsTaskCompletion(gate, { approved_gate_ids: [gate.beads_id] })).resolves.toMatchObject({
      action: 'allow_close',
      block_reasons: [],
    })
  })

  it('keeps wait nodes blocked until their wait condition is resolved', async () => {
    const wait = await readyTaskForQuest('firmvault', 'plan:firmvault-document-collection-wait-signed-documents')

    await expect(verifyWaypointBeadsTaskCompletion(wait)).resolves.toMatchObject({
      action: 'block_close',
      block_reasons: ['wait_condition_pending'],
    })

    await expect(verifyWaypointBeadsTaskCompletion(wait, { resolved_wait_ids: [wait.beads_id] })).resolves.toMatchObject({
      action: 'allow_close',
      block_reasons: [],
    })
  })

  it('requires explicit artifact verification before closing artifact-producing tasks', async () => {
    const chronology = await readyTaskForQuest('referral-package', 'plan:medical-chronology-update')

    await expect(verifyWaypointBeadsTaskCompletion(chronology)).resolves.toMatchObject({
      action: 'block_close',
      block_reasons: ['artifact_verifier_required'],
    })

    const missingVerifier = artifactVerifier((path) =>
      path === '03-medical/medical-chronology-output/medical-chronology.html'
        ? { status: 'missing' as const, reason: 'not written' }
        : { status: 'present' as const },
    )
    const missingResult = await verifyWaypointBeadsTaskCompletion(chronology, { artifactVerifier: missingVerifier })
    expect(missingResult).toMatchObject({
      action: 'block_close',
      block_reasons: ['required_artifacts_missing'],
    })
    expect(missingResult.artifacts).toContainEqual({
      path: '03-medical/medical-chronology-output/medical-chronology.html',
      status: 'missing',
      reason: 'not written',
    })

    await expect(
      verifyWaypointBeadsTaskCompletion(chronology, { artifactVerifier: artifactVerifier(() => ({ status: 'present' })) }),
    ).resolves.toMatchObject({
      action: 'allow_close',
      block_reasons: [],
    })
  })
})

async function readyTaskForQuest(quest: string, logicalId: string): Promise<WaypointBeadsRunTask> {
  const catalog = await loadBundledWaypointCatalog()
  const instantiated = await instantiateWaypointRouteInBeads(catalog, {
    quest,
    routeId: `route-${quest}`,
    subject: { type: 'project', id: 'local' },
    client: createRecordingClient(),
  })
  const statuses: Record<string, WaypointBeadsSnapshotStatus> = Object.fromEntries(
    instantiated.issues.map((issue) => [issue.logicalId, 'closed']),
  )
  statuses[`route:${quest}`] = 'open'
  statuses[logicalId] = 'open'

  const reconstruction = reconstructWaypointRunFromBeads(snapshotFromInstantiation(instantiated, statuses))
  const nodeKey = logicalId.replace(/^[^:]+:/, '')
  const task = reconstruction.tasks.find((candidate) => candidate.metadata.waypoint.node_key === nodeKey)
  if (!task) throw new Error(`Task not found: ${logicalId}`)
  return task
}

function snapshotFromInstantiation(
  result: WaypointBeadsInstantiationResult,
  statuses: Record<string, WaypointBeadsSnapshotStatus>,
) {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: statuses[issue.logicalId] ?? 'open',
      issue_type: issue.spec.issueType,
      metadata: issue.spec.metadata,
      ...(issue.spec.parent ? { parent: result.root.beadsId } : {}),
    })),
    dependencies: result.dependencies.map((dependency) => ({
      issue_id: dependency.dependent,
      depends_on_id: dependency.dependency,
      type: dependency.type,
    })),
  }
}

function artifactVerifier(
  statusForPath: (path: string) => { readonly status: 'present' | 'missing' | 'invalid'; readonly reason?: string },
): WaypointBeadsArtifactVerifier {
  return {
    async verifyArtifact(artifact) {
      return { path: artifact.path, ...statusForPath(artifact.path) }
    },
  }
}

function createRecordingClient(): WaypointBeadsIssueClient {
  let count = 0
  return {
    async createIssue() {
      count += 1
      return { id: `bd-${String(count).padStart(3, '0')}` }
    },
    async addDependency() {},
  }
}
