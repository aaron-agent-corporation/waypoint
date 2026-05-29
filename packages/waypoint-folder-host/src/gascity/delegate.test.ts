import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { installQuestCatalog } from '../catalog/install.ts'
import { readRouteEvents } from '../events/jsonl.ts'
import { initWaypointProject } from '../project/init.ts'
import { startQuestRoute } from '../routes/start.ts'
import type {
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
} from '../beads/instantiate.ts'
import type { WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import type { WaypointBeadsIssueKind } from '../beads/compiler.ts'
import type { WaypointBeadsSnapshotStatus } from '../beads/reconstruct.ts'
import { delegateWaypointRouteToGasCity, formatWaypointGasCityPreflightFailure } from './delegate.ts'
import type {
  WaypointGasCityCreateConvoyInput,
  WaypointGasCityPreflight,
  WaypointGasCitySlingBeadInput,
  WaypointGasCitySlingResult,
} from './cli-adapter.ts'

describe('delegateWaypointRouteToGasCity', () => {
  it('preflights and slings the current executable Beads task to Gas City', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRecordingRuntime()

    const result = await delegateWaypointRouteToGasCity({
      projectRoot,
      route,
      target: 'waypoint/codex',
      city: '/tmp/city',
      rig: 'waypoint',
      provider: 'codex',
      runtime,
      issueReader: createRouteIssueReader({
        rootId: 'bd-001',
        routedId: 'bd-002',
        routedMetadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      }),
      now: new Date('2026-05-28T00:00:00.000Z'),
    })

    expect(result).toMatchObject({
      routeId: 'route-001',
      target: 'waypoint/codex',
      beadId: 'bd-001',
      routedBeadId: 'bd-002',
      convoy: {
        convoyId: 'gc-convoy-001',
        name: 'waypoint-route-001',
        issueIds: ['bd-002'],
      },
      metadata: {
        ok: true,
        beadId: 'bd-002',
        routedTo: 'waypoint/codex',
        moleculeId: 'wpg-9ay',
      },
    })
    expect(runtime.preflightCalls).toEqual([{ provider: 'codex' }])
    expect(runtime.convoyCalls).toEqual([
      {
        city: '/tmp/city',
        rig: 'waypoint',
        name: 'waypoint-route-001',
        issueIds: ['bd-002'],
      },
    ])
    expect(runtime.slingCalls).toEqual([
      {
        city: '/tmp/city',
        rig: 'waypoint',
        target: 'waypoint/codex',
        beadId: 'gc-convoy-001',
        noFormula: true,
        nudge: true,
        dryRun: undefined,
        force: undefined,
      },
    ])

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.map((event) => event.kind)).toEqual(['route.started', 'route.runtime.delegated'])
    expect(events.items[1]?.payload).toMatchObject({
      runtime: 'gascity',
      target: 'waypoint/codex',
      bead_id: 'bd-001',
      routed_bead_id: 'bd-002',
      dispatch_bead_id: 'gc-convoy-001',
      convoy_id: 'gc-convoy-001',
      no_formula: true,
      nudge: true,
      metadata: {
        routed_to: 'waypoint/codex',
        molecule_id: 'wpg-9ay',
      },
    })
  })

  it('routes the next executable Beads task after the previous routed task closes', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRecordingRuntime()

    const result = await delegateWaypointRouteToGasCity({
      projectRoot,
      route,
      target: 'waypoint/codex',
      city: '/tmp/city',
      rig: 'waypoint',
      provider: 'codex',
      runtime,
      issueReader: createRouteIssueReader({
        rootId: 'bd-001',
        tasks: [
          {
            id: 'bd-002',
            title: 'Gather project context and starting constraints',
            status: 'closed',
            planRef: 'initialize-context',
            sequence: 1,
          },
          {
            id: 'bd-003',
            title: 'Draft implementation plan',
            status: 'open',
            planRef: 'draft-plan',
            sequence: 2,
            metadata: {
              'gc.routed_to': 'waypoint/codex',
              molecule_id: 'wpg-next',
            },
          },
        ],
      }),
      now: new Date('2026-05-28T00:00:00.000Z'),
    })

    expect(result).toMatchObject({
      routeId: 'route-001',
      target: 'waypoint/codex',
      beadId: 'bd-001',
      routedBeadId: 'bd-003',
      convoy: {
        convoyId: 'gc-convoy-001',
        name: 'waypoint-route-001',
        issueIds: ['bd-003'],
      },
      metadata: {
        ok: true,
        beadId: 'bd-003',
        routedTo: 'waypoint/codex',
        moleculeId: 'wpg-next',
      },
    })
    expect(runtime.convoyCalls).toEqual([
      {
        city: '/tmp/city',
        rig: 'waypoint',
        name: 'waypoint-route-001',
        issueIds: ['bd-003'],
      },
    ])
    expect(runtime.slingCalls).toEqual([
      {
        city: '/tmp/city',
        rig: 'waypoint',
        target: 'waypoint/codex',
        beadId: 'gc-convoy-001',
        noFormula: true,
        nudge: true,
        dryRun: undefined,
        force: undefined,
      },
    ])
  })

  it.each([
    ['gate', 'Human review gate'],
    ['wait', 'External wait'],
  ] as const)('stops at an open %s before dispatching later executable tasks', async (kind, title) => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRecordingRuntime()

    await expect(
      delegateWaypointRouteToGasCity({
        projectRoot,
        route,
        target: 'waypoint/codex',
        runtime,
        issueReader: createRouteIssueReader({
          rootId: 'bd-001',
          tasks: [
            {
              id: 'bd-002',
              title: 'Gather project context and starting constraints',
              status: 'closed',
              planRef: 'initialize-context',
              sequence: 1,
            },
            {
              id: 'bd-003',
              title,
              status: 'open',
              kind,
              planRef: `${kind}-node`,
              sequence: 2,
            },
            {
              id: 'bd-004',
              title: 'Later executable task',
              status: 'open',
              planRef: 'later-executable',
              sequence: 3,
              metadata: {
                'gc.routed_to': 'waypoint/codex',
                molecule_id: 'wpg-later',
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow('has no current Gas City-routable Beads task')

    expect(runtime.preflightCalls).toEqual([{ provider: undefined }])
    expect(runtime.convoyCalls).toEqual([])
    expect(runtime.slingCalls).toEqual([])
  })

  it('writes route metadata without calling Gas City sling when no-nudge is requested', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRecordingRuntime()
    const issueReader = createMutableIssueReader({
      id: 'bd-001',
      title: 'Waypoint route',
      status: 'open',
      metadata: {
        waypoint: { route_id: 'route-001' },
      },
    })

    const result = await delegateWaypointRouteToGasCity({
      projectRoot,
      route,
      target: 'waypoint/codex',
      runtime,
      issueReader,
      nudge: false,
      now: new Date('2026-05-28T00:00:00.000Z'),
    })

    expect(runtime.slingCalls).toEqual([])
    expect(issueReader.metadataUpdates).toEqual([
      {
        id: 'bd-001',
        metadata: { 'gc.routed_to': 'waypoint/codex' },
      },
    ])
    expect(result).toMatchObject({
      routeId: 'route-001',
      target: 'waypoint/codex',
      beadId: 'bd-001',
      routedBeadId: 'bd-001',
      sling: {
        mode: 'metadata-only',
      },
      metadata: {
        ok: true,
        routedTo: 'waypoint/codex',
      },
    })

    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items[1]?.payload).toMatchObject({
      runtime: 'gascity',
      target: 'waypoint/codex',
      bead_id: 'bd-001',
      routed_bead_id: 'bd-001',
      no_formula: true,
      nudge: false,
      delegation_mode: 'metadata-only',
      metadata: {
        routed_to: 'waypoint/codex',
      },
    })
  })

  it('rejects non-Beads routes before calling Gas City', async () => {
    const projectRoot = await tempProject('folder')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint' })
    const runtime = createRecordingRuntime()

    await expect(
      delegateWaypointRouteToGasCity({
        projectRoot,
        route,
        target: 'waypoint/codex',
        runtime,
      }),
    ).rejects.toThrow('requires a Beads-backed route')
    expect(runtime.preflightCalls).toEqual([])
    expect(runtime.slingCalls).toEqual([])
  })

  it('surfaces failed preflight without slinging work', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const preflight: WaypointGasCityPreflight = {
      ok: false,
      checks: [
        {
          tool: 'gc',
          command: 'gc',
          args: ['version'],
          ok: false,
          details: 'spawn gc ENOENT',
          guidance: 'Install Gas City.',
        },
      ],
    }
    const runtime = createRecordingRuntime(preflight)

    await expect(
      delegateWaypointRouteToGasCity({
        projectRoot,
        route,
        target: 'waypoint/codex',
        runtime,
      }),
    ).rejects.toThrow('Gas City preflight failed')
    expect(runtime.slingCalls).toEqual([])
    expect(formatWaypointGasCityPreflightFailure(preflight)).toContain('Install Gas City.')
  })

  it('fails immediately when sling does not leave routable Gas City metadata on the Bead', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRecordingRuntime()

    await expect(
      delegateWaypointRouteToGasCity({
        projectRoot,
        route,
        target: 'waypoint/codex',
        runtime,
        issueReader: createRouteIssueReader({
          rootId: 'bd-001',
          routedId: 'bd-002',
          routedMetadata: {
            waypoint: { route_id: 'route-001' },
          },
        }),
      }),
    ).rejects.toThrow('bd update bd-002 --set-metadata gc.routed_to=waypoint/codex')
    expect(runtime.slingCalls).toHaveLength(1)
  })
})

async function tempProject(backend: 'folder' | 'beads'): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-gascity-delegate-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint', backend })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  return projectRoot
}

function createRecordingClient(): WaypointBeadsIssueClient {
  let issueNumber = 0
  return {
    async createIssue(_input: WaypointBeadsIssueCreateInput) {
      issueNumber += 1
      return { id: `bd-${String(issueNumber).padStart(3, '0')}` }
    },
    async addDependency(_input: WaypointBeadsDependencyCreateInput) {
      return undefined
    },
  }
}

function createRouteIssueReader(input: {
  readonly rootId: string
  readonly routedId?: string
  readonly routedMetadata?: Record<string, unknown>
  readonly tasks?: readonly RouteIssueReaderTask[]
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      const tasks = input.tasks ?? [
        {
          id: input.routedId ?? 'bd-002',
          title: 'Gather project context and starting constraints',
          status: 'open',
          planRef: 'initialize-context',
          sequence: 1,
          metadata: input.routedMetadata,
        },
      ]
      return {
        issues: [
          {
            id: input.rootId,
            title: 'Waypoint route',
            status: 'open',
            issue_type: 'epic',
            metadata: waypointMetadata('route'),
          },
          ...tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            issue_type: 'task',
            metadata: {
              ...task.metadata,
              waypoint: waypointMetadata(task.kind ?? 'checkpoint', task.planRef, task.sequence).waypoint,
            },
          })),
        ],
        dependencies: [],
      }
    },
  }
}

interface RouteIssueReaderTask {
  readonly id: string
  readonly title: string
  readonly status: WaypointBeadsSnapshotStatus
  readonly planRef: string
  readonly sequence: number
  readonly kind?: Exclude<WaypointBeadsIssueKind, 'route'>
  readonly metadata?: Record<string, unknown>
}

function waypointMetadata(kind: 'route' | Exclude<WaypointBeadsIssueKind, 'route'>, nodeKey?: string, sequence = 1): Record<string, unknown> {
  return {
    waypoint: {
      schema_version: 1,
      kind,
      quest_slug: 'waypoint',
      route_id: 'route-001',
      subject: { type: 'project', id: 'local' },
      policy: { external_side_effects: 'unspecified' },
      ...(nodeKey
        ? {
            node_key: nodeKey,
            scaffold: {
              workstream: 'delivery',
              milestone: 'v1',
              phase: 'initialize',
              plan_ref: nodeKey,
              sequence,
              wave: 10,
            },
          }
        : {}),
    },
  }
}

function createMutableIssueReader(issue: {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly assignee?: string
  readonly metadata?: Record<string, unknown>
}): WaypointBeadsIssueSnapshotReader & {
  readonly metadataUpdates: Array<{ id: string; metadata: Readonly<Record<string, string>> }>
  updateIssueMetadata(input: { readonly id: string; readonly metadata: Readonly<Record<string, string>> }): Promise<void>
} {
  const metadataUpdates: Array<{ id: string; metadata: Readonly<Record<string, string>> }> = []
  const mutableIssue = { ...issue, metadata: { ...(issue.metadata ?? {}) } }
  return {
    metadataUpdates,
    async listIssueSnapshots() {
      return {
        issues: [mutableIssue],
        dependencies: [],
      }
    },
    async updateIssueMetadata(input) {
      metadataUpdates.push(input)
      mutableIssue.metadata = { ...mutableIssue.metadata, ...input.metadata }
    },
  }
}

function createRecordingRuntime(preflight: WaypointGasCityPreflight = passingPreflight()): {
  readonly preflightCalls: unknown[]
  readonly convoyCalls: WaypointGasCityCreateConvoyInput[]
  readonly slingCalls: WaypointGasCitySlingBeadInput[]
  preflight(input?: unknown): Promise<WaypointGasCityPreflight>
  createConvoy(input: WaypointGasCityCreateConvoyInput): Promise<{
    command: string
    stdout: string
    stderr: string
    convoyId: string
    name: string
    issueIds: readonly string[]
  }>
  slingBead(input: WaypointGasCitySlingBeadInput): Promise<WaypointGasCitySlingResult>
} {
  const preflightCalls: unknown[] = []
  const convoyCalls: WaypointGasCityCreateConvoyInput[] = []
  const slingCalls: WaypointGasCitySlingBeadInput[] = []
  return {
    preflightCalls,
    convoyCalls,
    slingCalls,
    async preflight(input) {
      preflightCalls.push(input)
      return preflight
    },
    async createConvoy(input) {
      convoyCalls.push(input)
      return {
        command: 'gc',
        stdout: 'Created convoy gc-convoy-001 "waypoint-route-001" tracking 1 issue(s)\n',
        stderr: '',
        convoyId: 'gc-convoy-001',
        name: input.name,
        issueIds: input.issueIds ?? [],
      }
    },
    async slingBead(input) {
      slingCalls.push(input)
      return {
        command: 'gc',
        stdout: 'routed\n',
        stderr: '',
        target: input.target,
        beadId: input.beadId,
      }
    },
  }
}

function passingPreflight(): WaypointGasCityPreflight {
  return {
    ok: true,
    checks: [
      {
        tool: 'gc',
        command: 'gc',
        args: ['version'],
        ok: true,
        version: '1.1.0',
      },
    ],
  }
}
