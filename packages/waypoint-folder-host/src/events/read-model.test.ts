import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { WaypointBeadsIssueCommentReader, WaypointBeadsIssueSnapshotReader } from '../beads/cli-client'
import { instantiateWaypointRouteInBeads, type WaypointBeadsInstantiationResult, type WaypointBeadsIssueClient } from '../beads/instantiate'
import type { WaypointBeadsDependencySnapshot, WaypointBeadsIssueSnapshot } from '../beads/reconstruct'
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
    expect(gate).toBeTruthy()
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
    })

    const page = await readWaypointRuntimeRouteEvents(projectRoot, 'route-waypoint', {
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated)),
      beadsCommentReader: comments,
    })

    expect(page.total).toBe(3)
    expect(page.items.map((event) => event.kind)).toEqual(['route.started', 'route.paused', 'route.gate.approved'])
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
        text: 'Waypoint gate approved on route route-waypoint: plan-approval-gate\n\nApproved.',
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

function snapshotFromInstantiation(result: WaypointBeadsInstantiationResult): {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
} {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: 'open',
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
