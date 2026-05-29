import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { WaypointBeadsIssueCommentReader, WaypointBeadsIssueSnapshotReader } from '../beads/cli-client'
import { instantiateWaypointRouteInBeads, type WaypointBeadsInstantiationResult, type WaypointBeadsIssueClient } from '../beads/instantiate'
import type { WaypointBeadsDependencySnapshot, WaypointBeadsIssueSnapshot, WaypointBeadsSnapshotStatus } from '../beads/reconstruct'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { readWaypointRuntimeRouteEvents } from './read-model'

describe('Waypoint runtime route events', () => {
  it('reconstructs Beads route events from route and task comments', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-events-beads-'))
    await initWaypointProject(projectRoot, { quest: 'waypoint', backend: 'beads' })
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'waypoint',
      routeId: 'route-waypoint',
      subject: { type: 'project', id: 'local' },
      client: createRecordingIssueClient(),
    })
    const gate = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'gate')
    const checkpoint = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'checkpoint')
    expect(gate).toBeTruthy()
    expect(checkpoint).toBeTruthy()
    const comments = commentsByIssue({
      [instantiated.root.beadsId]: [
        {
          id: 'comment-001',
          issue_id: instantiated.root.beadsId,
          text: 'Waypoint route paused on route route-waypoint\n\nWaiting on owner.',
          created_at: '2026-05-27T12:01:00.000Z',
        },
      ],
      [gate!.beadsId]: [
        {
          id: 'comment-002',
          issue_id: gate!.beadsId,
          text: 'Waypoint gate approved on route route-waypoint: plan-approval-gate\n\nApproved.',
          created_at: '2026-05-27T12:02:00.000Z',
        },
      ],
      [checkpoint!.beadsId]: [
        {
          id: 'comment-003',
          issue_id: checkpoint!.beadsId,
          text: 'Worker completed the checkpoint and attached notes.',
          created_at: '2026-05-27T12:03:00.000Z',
        },
      ],
    })

    const page = await readWaypointRuntimeRouteEvents(projectRoot, 'route-waypoint', {
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated, { [checkpoint!.logicalId]: 'closed' })),
      beadsCommentReader: comments,
    })

    expect(page.total).toBe(4)
    expect(page.items.map((event) => event.kind)).toEqual(['route.started', 'route.paused', 'route.gate.approved', 'route.issue.comment'])
    expect(page.items[1]).toMatchObject({
      id: `beads-${instantiated.root.beadsId}-comment-001`,
      payload: { backend: 'beads', issue_id: instantiated.root.beadsId },
    })
    expect(page.items[2]).toMatchObject({
      payload: {
        backend: 'beads',
        issue_id: gate?.beadsId,
        task_id: gate?.beadsId,
        task_kind: 'gate',
        task_status: 'blocked',
        text: 'Waypoint gate approved on route route-waypoint: plan-approval-gate\n\nApproved.',
      },
    })
    expect(page.items[3]).toMatchObject({
      payload: {
        backend: 'beads',
        issue_id: checkpoint?.beadsId,
        task_id: checkpoint?.beadsId,
        task_kind: 'checkpoint',
        task_status: 'done',
        text: 'Worker completed the checkpoint and attached notes.',
      },
    })
  })
})

function snapshotReader(snapshot: {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return snapshot
    },
  }
}

function snapshotFromInstantiation(result: WaypointBeadsInstantiationResult, statuses: Record<string, WaypointBeadsSnapshotStatus> = {}): {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
} {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: statuses[issue.logicalId] ?? 'open',
      issue_type: issue.spec.issueType,
      created_at: '2026-05-27T12:00:00.000Z',
      updated_at: '2026-05-27T12:00:00.000Z',
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

function createRecordingIssueClient(): WaypointBeadsIssueClient {
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

function commentsByIssue(
  comments: Record<string, Awaited<ReturnType<WaypointBeadsIssueCommentReader['listIssueComments']>>>,
): WaypointBeadsIssueCommentReader {
  return {
    async listIssueComments(issueId) {
      return comments[issueId] ?? []
    },
  }
}
