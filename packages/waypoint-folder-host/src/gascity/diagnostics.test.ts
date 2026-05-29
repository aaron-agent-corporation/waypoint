import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { installQuestCatalog } from '../catalog/install.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { initWaypointProject } from '../project/init.ts'
import { startQuestRoute } from '../routes/start.ts'
import type {
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
} from '../beads/instantiate.ts'
import { inspectWaypointGasCityRoute, type WaypointGasCityDiagnosticsRuntime } from './diagnostics.ts'

describe('inspectWaypointGasCityRoute', () => {
  it('detects missing route metadata and stuck worker sessions', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createDiagnosticsRuntime({
      sessions: [{ id: 'codex-creating-001', status: 'creating', target: 'waypoint/codex', ageSeconds: 900, raw: {} }],
      events: [],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-route-metadata-missing',
      'gascity-worker-stuck-creating',
    ])
    expect(result.routedBeadId).toBe('bd-002')
    expect(result.diagnostics[0]?.guidance.join('\n')).toContain('bd update bd-002 --set-metadata gc.routed_to=waypoint/codex')
  })

  it('detects work assigned to inactive Gas City sessions', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createDiagnosticsRuntime({
      sessions: [{ id: 'codex-old', status: 'suspended', target: 'waypoint/codex', raw: {} }],
      events: [{ type: 'session.drained', message: 'config-drift', payload: { reason: 'config-drift' } }],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'in_progress',
      routedAssignee: 'codex-old',
      routedMetadata: {
        'gc.routed_to': 'waypoint/codex',
        molecule_id: 'wpg-9ay',
      },
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-work-stranded-on-drained-assignee',
      'gascity-worker-drained-config-drift',
    ])
    expect(result.routedBeadId).toBe('bd-002')
    expect(result.diagnostics[0]?.guidance.join('\n')).toContain('bd show bd-002 --json')
  })

  it('detects routed work that was started and released back to open', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createDiagnosticsRuntime({
      sessions: [{ id: 'codex-ci-ak4', status: 'asleep', template: 'waypoint/codex', sessionName: 'codex-ci-ak4', raw: {} }],
      events: [{ type: 'session.drain_acked_with_assigned_work', message: 'session drain-acked while still assigned to work bead' }],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
      routedStartedAt: '2026-05-28T17:33:39Z',
      routedMetadata: {
        'gc.routed_to': 'waypoint/codex',
        molecule_id: 'wpg-9ay',
      },
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.task.startedAt).toBe('2026-05-28T17:33:39Z')
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-work-claim-released-after-start',
    ])
    expect(result.diagnostics[0]?.guidance.join('\n')).toContain('Require an explicit recovery policy')
  })

  it('accepts Gas City session names as valid assignee ownership', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createDiagnosticsRuntime({
      sessions: [{
        id: 'ci-sal',
        status: 'active',
        target: 'codex-ci-sal',
        template: 'waypoint/codex',
        sessionName: 'codex-ci-sal',
        agentName: 'waypoint/codex',
        raw: {},
      }],
      events: [],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'in_progress',
      routedAssignee: 'codex-ci-sal',
      routedMetadata: {
        'gc.routed_to': 'waypoint/codex',
        molecule_id: 'wpg-9ay',
      },
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.routedBeadId).toBe('bd-002')
  })

  it('diagnoses metadata-only no-nudge routes against the route root', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.runtime.delegated',
      payload: {
        runtime: 'gascity',
        target: 'waypoint/codex',
        bead_id: 'bd-001',
        routed_bead_id: 'bd-001',
        nudge: false,
        delegation_mode: 'metadata-only',
        metadata: {
          routed_to: 'waypoint/codex',
        },
      },
    })
    const runtime = createDiagnosticsRuntime({
      sessions: [],
      events: [],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      rootMetadata: { 'gc.routed_to': 'waypoint/codex' },
      routedId: 'bd-002',
      routedStatus: 'open',
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.routedBeadId).toBe('bd-001')
    expect(result.task.id).toBe('bd-001')
    expect(result.diagnostics).toEqual([])
  })

  it('ignores dry-run delegation probes when diagnosing the active Gas City handoff', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.runtime.delegated',
      payload: {
        runtime: 'gascity',
        target: 'waypoint/codex',
        bead_id: 'bd-001',
        routed_bead_id: 'bd-002',
        dry_run: false,
        nudge: true,
        delegation_mode: 'gascity-sling',
        metadata: {
          routed_to: 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
    })
    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.runtime.delegated',
      payload: {
        runtime: 'gascity',
        target: 'waypoint/codex',
        bead_id: 'bd-001',
        routed_bead_id: 'bd-003',
        dry_run: true,
        nudge: true,
        delegation_mode: 'gascity-sling',
        metadata: {
          routed_to: null,
        },
      },
    })
    const runtime = createDiagnosticsRuntime({
      sessions: [],
      events: [],
    })
    const issueReader = createMultiIssueReader([
      {
        id: 'bd-001',
        title: 'Waypoint route',
        status: 'open',
        issue_type: 'epic',
        metadata: waypointMetadata('route'),
      },
      {
        id: 'bd-002',
        title: 'Gather project context and starting constraints',
        status: 'closed',
        issue_type: 'task',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
          ...waypointMetadata('checkpoint', 'initialize-context'),
        },
      },
      {
        id: 'bd-003',
        title: 'Draft initial roadmap and Quest adoption notes',
        status: 'open',
        issue_type: 'task',
        metadata: waypointMetadata('checkpoint', 'initialize-roadmap'),
      },
    ])

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.routedBeadId).toBe('bd-002')
    expect(result.task.id).toBe('bd-002')
    expect(result.diagnostics).toEqual([])
  })

  it('reports preflight failures without reading Gas City sessions or events', async () => {
    const projectRoot = await tempProject('beads')
    const route = await startQuestRoute(projectRoot, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createDiagnosticsRuntime({
      preflightOk: false,
      sessions: [{ id: 'should-not-read', status: 'running', raw: {} }],
      events: [{ type: 'should-not-read' }],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
      routedMetadata: { 'gc.routed_to': 'waypoint/codex' },
    })

    const result = await inspectWaypointGasCityRoute({
      projectRoot,
      routeId: route.id,
      target: 'waypoint/codex',
      runtime,
      issueReader,
    })

    expect(result.preflight.ok).toBe(false)
    expect(result.sessions.sessions).toEqual([])
    expect(result.events.events).toEqual([])
    expect(runtime.sessionReads).toBe(0)
    expect(runtime.eventReads).toBe(0)
  })
})

async function tempProject(backend: 'beads'): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-gascity-diagnostics-'))
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
  readonly id: string
  readonly rootMetadata?: Record<string, unknown>
  readonly routedId: string
  readonly routedStatus: string
  readonly routedAssignee?: string
  readonly routedStartedAt?: string
  readonly routedClosedAt?: string
  readonly routedNotes?: string
  readonly routedMetadata?: Record<string, unknown>
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return {
        issues: [
          {
            id: input.id,
            title: 'Waypoint route',
            status: 'open',
            issue_type: 'epic',
            metadata: {
              ...input.rootMetadata,
              waypoint: waypointMetadata('route').waypoint,
            },
          },
          {
            id: input.routedId,
            title: 'Gather project context and starting constraints',
            status: input.routedStatus,
            issue_type: 'task',
            ...(input.routedAssignee ? { assignee: input.routedAssignee } : {}),
            ...(input.routedStartedAt ? { started_at: input.routedStartedAt } : {}),
            ...(input.routedClosedAt ? { closed_at: input.routedClosedAt } : {}),
            ...(input.routedNotes ? { notes: input.routedNotes } : {}),
            metadata: {
              ...input.routedMetadata,
              waypoint: waypointMetadata('checkpoint', 'initialize-context').waypoint,
            },
          },
        ],
        dependencies: [],
      }
    },
  }
}

function createMultiIssueReader(issues: Awaited<ReturnType<WaypointBeadsIssueSnapshotReader['listIssueSnapshots']>>['issues']): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return {
        issues,
        dependencies: [],
      }
    },
  }
}

function waypointMetadata(kind: 'route' | 'checkpoint', nodeKey?: string): Record<string, unknown> {
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
              sequence: 1,
              wave: 10,
            },
          }
        : {}),
    },
  }
}

function createDiagnosticsRuntime(input: {
  readonly preflightOk?: boolean
  readonly sessions: Awaited<ReturnType<WaypointGasCityDiagnosticsRuntime['listSessions']>>['sessions']
  readonly events: Awaited<ReturnType<WaypointGasCityDiagnosticsRuntime['readEvents']>>['events']
}): WaypointGasCityDiagnosticsRuntime & { sessionReads: number; eventReads: number } {
  let sessionReads = 0
  let eventReads = 0
  return {
    get sessionReads() {
      return sessionReads
    },
    get eventReads() {
      return eventReads
    },
    async preflight() {
      const ok = input.preflightOk ?? true
      return {
        ok,
        checks: [
          {
            tool: 'gc',
            command: 'gc',
            args: ['version'],
            ok,
            ...(ok ? { version: '1.1.0' } : { details: 'spawn gc ENOENT', guidance: 'Install Gas City.' }),
          },
        ],
      }
    },
    async listSessions() {
      sessionReads += 1
      return { sessions: input.sessions, raw: input.sessions }
    },
    async readEvents() {
      eventReads += 1
      return { events: input.events, raw: input.events.map((event) => JSON.stringify(event)).join('\n') }
    },
  }
}
