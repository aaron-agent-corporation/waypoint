import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
} from '../beads/instantiate'
import {
  type WaypointBeadsDependencySnapshot,
  type WaypointBeadsIssueSnapshot,
  type WaypointBeadsSnapshotStatus,
} from '../beads/reconstruct'
import type {
  WaypointBeadsIssueCloseInput,
  WaypointBeadsIssueCommentInput,
  WaypointBeadsIssueMutationClient,
  WaypointBeadsIssueStatusUpdateInput,
  WaypointBeadsIssueSnapshotReader,
} from '../beads/cli-client'
import { runWaypointAutopilot } from './run'

describe('Beads-backed Waypoint autopilot', () => {
  it('closes ready checkpoint tasks and records a local autopilot run', async () => {
    const projectRoot = await beadsProject('waypoint')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'waypoint',
      routeId: 'route-waypoint',
      subject: { type: 'project', id: 'local' },
      client: createRecordingIssueClient(),
    })
    const firstCheckpoint = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'checkpoint')
    expect(firstCheckpoint).toBeTruthy()
    const beadsMutator = createRecordingMutator()

    const result = await runWaypointAutopilot(projectRoot, {
      routeId: 'route-waypoint',
      maxIterations: 1,
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated)),
      beadsMutator,
    })

    expect(result).toMatchObject({
      routeId: 'route-waypoint',
      status: 'iteration_cap',
      iterations: 1,
      completedTasks: [firstCheckpoint?.beadsId],
    })
    expect(beadsMutator.closes).toEqual([
      {
        id: firstCheckpoint?.beadsId,
        reason: `Waypoint autopilot completed checkpoint ${firstCheckpoint?.spec.metadata.waypoint.node_key}`,
      },
    ])
  })

  it('blocks recipe execution when runtime side-effect policy is unsafe', async () => {
    const projectRoot = await beadsProject('referral-package')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    const forbiddenRecipe = instantiated.issues.find(
      (issue) =>
        issue.spec.metadata.waypoint.kind === 'recipe' &&
        issue.spec.metadata.waypoint.policy.external_side_effects === 'forbidden',
    )
    expect(forbiddenRecipe).toBeTruthy()
    const statuses = closedExcept(instantiated, ['route:referral-package', forbiddenRecipe!.logicalId])
    const beadsMutator = createRecordingMutator()

    const result = await runWaypointAutopilot(projectRoot, {
      routeId: 'route-referral',
      maxIterations: 1,
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated, statuses)),
      beadsMutator,
      beadsRuntimePolicy: { external_side_effects: 'allowed' },
    })

    expect(result).toMatchObject({
      status: 'blocked',
      blockedNode: forbiddenRecipe?.spec.metadata.waypoint.node_key,
      completedTasks: [],
    })
    expect(beadsMutator.statusUpdates).toEqual([
      {
        id: forbiddenRecipe?.beadsId,
        status: 'blocked',
        note: 'Waypoint autopilot recipe blocked: external_side_effects_forbidden',
      },
    ])
    expect(beadsMutator.closes).toEqual([])
  })
})

async function beadsProject(quest: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-beads-auto-'))
  await initWaypointProject(projectRoot, { quest, backend: 'beads' })
  return projectRoot
}

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

function snapshotFromInstantiation(
  result: WaypointBeadsInstantiationResult,
  statuses: Record<string, WaypointBeadsSnapshotStatus> = {},
): {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
} {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: statuses[issue.logicalId] ?? 'open',
      issue_type: issue.spec.issueType,
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:00:00.000Z',
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

function closedExcept(
  result: WaypointBeadsInstantiationResult,
  openLogicalIds: readonly string[],
): Record<string, WaypointBeadsSnapshotStatus> {
  const open = new Set(openLogicalIds)
  return Object.fromEntries(result.issues.map((issue) => [issue.logicalId, open.has(issue.logicalId) ? 'open' : 'closed']))
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

function createRecordingMutator(): WaypointBeadsIssueMutationClient & {
  readonly closes: WaypointBeadsIssueCloseInput[]
  readonly statusUpdates: WaypointBeadsIssueStatusUpdateInput[]
  readonly comments: WaypointBeadsIssueCommentInput[]
} {
  const closes: WaypointBeadsIssueCloseInput[] = []
  const statusUpdates: WaypointBeadsIssueStatusUpdateInput[] = []
  const comments: WaypointBeadsIssueCommentInput[] = []
  return {
    closes,
    statusUpdates,
    comments,
    async closeIssue(input) {
      closes.push(input)
    },
    async updateIssueStatus(input) {
      statusUpdates.push(input)
    },
    async addIssueComment(input) {
      comments.push(input)
    },
  }
}
