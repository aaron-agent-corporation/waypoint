import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { approveRouteGate, pauseWaypointRoute, rejectRouteGate, resolveWaypointRouteBlocker, resumeWaypointRoute } from '../routes/state'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
} from './instantiate'
import {
  type WaypointBeadsDependencySnapshot,
  type WaypointBeadsIssueSnapshot,
  type WaypointBeadsSnapshotStatus,
} from './reconstruct'
import type {
  WaypointBeadsIssueCloseInput,
  WaypointBeadsIssueCommentInput,
  WaypointBeadsIssueMutationClient,
  WaypointBeadsIssueStatusUpdateInput,
  WaypointBeadsIssueSnapshotReader,
} from './cli-client'

describe('Waypoint Beads route transitions', () => {
  it('approves a Beads gate by commenting and closing the gate issue', async () => {
    const projectRoot = await beadsProject('referral-package')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    const statuses = closedExcept(instantiated, ['route:referral-package', 'plan:attorney-handoff-gate', 'plan:handoff-ready-summary'])
    const gate = instantiated.issues.find((issue) => issue.logicalId === 'plan:attorney-handoff-gate')
    const beadsReader = snapshotReader(snapshotFromInstantiation(instantiated, statuses))
    const beadsMutator = createRecordingMutator()

    const route = await approveRouteGate(projectRoot, {
      routeId: 'route-referral',
      node: 'attorney-handoff-gate',
      note: 'Approved for attorney handoff.',
      beadsReader,
      beadsMutator,
    })

    expect(route).toMatchObject({ id: 'route-referral', status: 'active', current_node: 'attorney-handoff-gate' })
    expect(beadsMutator.comments).toEqual([
      {
        id: gate?.beadsId,
        text: 'Waypoint gate approved on route route-referral: attorney-handoff-gate\n\nApproved for attorney handoff.',
      },
    ])
    expect(beadsMutator.closes).toEqual([
      {
        id: gate?.beadsId,
        reason: 'Approved Waypoint gate attorney-handoff-gate on route route-referral: Approved for attorney handoff.',
      },
    ])
  })

  it('rejects a Beads gate without unblocking downstream work', async () => {
    const projectRoot = await beadsProject('referral-package')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    const statuses = closedExcept(instantiated, ['route:referral-package', 'plan:attorney-handoff-gate', 'plan:handoff-ready-summary'])
    const gate = instantiated.issues.find((issue) => issue.logicalId === 'plan:attorney-handoff-gate')
    const beadsReader = snapshotReader(snapshotFromInstantiation(instantiated, statuses))
    const beadsMutator = createRecordingMutator()

    const route = await rejectRouteGate(projectRoot, {
      routeId: 'route-referral',
      node: 'attorney-handoff-gate',
      note: 'Needs revision.',
      beadsReader,
      beadsMutator,
    })

    expect(route).toMatchObject({ id: 'route-referral', status: 'blocked', current_node: 'attorney-handoff-gate' })
    expect(beadsMutator.statusUpdates).toEqual([
      {
        id: gate?.beadsId,
        status: 'blocked',
        note: 'Waypoint gate rejected on route route-referral: attorney-handoff-gate\n\nNeeds revision.',
      },
    ])
    expect(beadsMutator.closes).toEqual([])
  })

  it('resolves wait blockers but refuses to bypass human gates through resume', async () => {
    const projectRoot = await beadsProject('firmvault')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'firmvault',
      routeId: 'route-firmvault',
      subject: { type: 'case', id: 'firmvault-fixture' },
      client: createRecordingIssueClient(),
    })
    const wait = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'wait')
    expect(wait).toBeTruthy()
    const statuses = closedExcept(instantiated, ['route:firmvault', wait!.logicalId])
    const beadsMutator = createRecordingMutator()

    const route = await resolveWaypointRouteBlocker(projectRoot, {
      routeId: 'route-firmvault',
      note: 'Signed documents received.',
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated, statuses)),
      beadsMutator,
    })

    expect(route).toMatchObject({ id: 'route-firmvault', status: 'active', current_node: wait?.spec.metadata.waypoint.node_key })
    expect(beadsMutator.closes).toEqual([
      {
        id: wait?.beadsId,
        reason: `Resolved Waypoint blocker ${wait?.spec.metadata.waypoint.node_key} on route route-firmvault: Signed documents received.`,
      },
    ])

    const referral = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    const gateStatuses = closedExcept(referral, ['route:referral-package', 'plan:attorney-handoff-gate'])
    await expect(
      resolveWaypointRouteBlocker(projectRoot, {
        routeId: 'route-referral',
        beadsReader: snapshotReader(snapshotFromInstantiation(referral, gateStatuses)),
        beadsMutator: createRecordingMutator(),
      }),
    ).rejects.toThrow('Cannot resolve human gate attorney-handoff-gate with resume; use waypoint gate --approve')
  })

  it('throws and performs no mutation when approving a non-current beads gate', async () => {
    const projectRoot = await beadsProject('referral-package')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    // All tasks closed except the route root and a non-gate task, so current_node is NOT the gate
    const nonGateTask = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind !== 'route' && issue.spec.metadata.waypoint.kind !== 'gate')
    expect(nonGateTask).toBeTruthy()
    const statuses = closedExcept(instantiated, ['route:referral-package', nonGateTask!.logicalId])
    // Inject the gate as open so requireTask finds it, but current_node will be nonGateTask
    const gateIssue = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'gate')
    expect(gateIssue).toBeTruthy()
    const statusesWithGateOpen = { ...statuses, [gateIssue!.logicalId]: 'open' as const }
    const beadsReader = snapshotReader(snapshotFromInstantiation(instantiated, statusesWithGateOpen))
    const beadsMutator = createRecordingMutator()

    await expect(
      approveRouteGate(projectRoot, {
        routeId: 'route-referral',
        node: 'attorney-handoff-gate',
        beadsReader,
        beadsMutator,
      }),
    ).rejects.toThrow('is not the current gate of route')

    expect(beadsMutator.comments).toEqual([])
    expect(beadsMutator.closes).toEqual([])
  })

  it('throws and performs no mutation when rejecting a non-current beads gate', async () => {
    const projectRoot = await beadsProject('referral-package')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
      client: createRecordingIssueClient(),
    })
    // All tasks closed except the route root and a non-gate task, so current_node is NOT the gate
    const nonGateTask = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind !== 'route' && issue.spec.metadata.waypoint.kind !== 'gate')
    expect(nonGateTask).toBeTruthy()
    const statuses = closedExcept(instantiated, ['route:referral-package', nonGateTask!.logicalId])
    // Inject the gate as open so requireTask finds it, but current_node will be nonGateTask
    const gateIssue = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'gate')
    expect(gateIssue).toBeTruthy()
    const statusesWithGateOpen = { ...statuses, [gateIssue!.logicalId]: 'open' as const }
    const beadsReader = snapshotReader(snapshotFromInstantiation(instantiated, statusesWithGateOpen))
    const beadsMutator = createRecordingMutator()

    await expect(
      rejectRouteGate(projectRoot, {
        routeId: 'route-referral',
        node: 'attorney-handoff-gate',
        beadsReader,
        beadsMutator,
      }),
    ).rejects.toThrow('is not the current gate of route')

    expect(beadsMutator.comments).toEqual([])
    expect(beadsMutator.statusUpdates).toEqual([])
  })

  it('pauses and resumes the Beads route issue without closing task blockers', async () => {
    const projectRoot = await beadsProject('waypoint')
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'waypoint',
      routeId: 'route-waypoint',
      subject: { type: 'project', id: 'local' },
      client: createRecordingIssueClient(),
    })
    const firstTask = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind !== 'route')
    expect(firstTask).toBeTruthy()

    const openStatuses = closedExcept(instantiated, [instantiated.root.logicalId, firstTask!.logicalId])
    const pauseMutator = createRecordingMutator()
    const paused = await pauseWaypointRoute(projectRoot, {
      routeId: 'route-waypoint',
      reason: 'Waiting on owner review.',
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated, openStatuses)),
      beadsMutator: pauseMutator,
    })

    expect(paused).toMatchObject({ id: 'route-waypoint', status: 'blocked', current_node: firstTask?.spec.metadata.waypoint.node_key })
    expect(pauseMutator.statusUpdates).toEqual([
      {
        id: instantiated.root.beadsId,
        status: 'blocked',
        note: 'Waypoint route paused on route route-waypoint\n\nWaiting on owner review.',
      },
    ])
    expect(pauseMutator.closes).toEqual([])

    const resumeStatuses = { ...openStatuses, [instantiated.root.logicalId]: 'blocked' }
    const resumeMutator = createRecordingMutator()
    const resumed = await resumeWaypointRoute(projectRoot, {
      routeId: 'route-waypoint',
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated, resumeStatuses)),
      beadsMutator: resumeMutator,
    })

    expect(resumed).toMatchObject({ id: 'route-waypoint', status: 'active', current_node: firstTask?.spec.metadata.waypoint.node_key })
    expect(resumeMutator.statusUpdates).toEqual([
      {
        id: instantiated.root.beadsId,
        status: 'open',
        note: 'Waypoint route resumed on route route-waypoint',
      },
    ])
    expect(resumeMutator.closes).toEqual([])
  })
})

async function beadsProject(quest: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-beads-transitions-'))
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
