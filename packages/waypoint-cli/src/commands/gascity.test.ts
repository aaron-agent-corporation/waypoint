import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type {
  WaypointBeadsIssueSnapshotReader,
  WaypointGasCityDiagnosticsRuntime,
  WaypointGasCityCreateConvoyInput,
  WaypointGasCitySlingBeadInput,
  WaypointGasCitySlingResult,
} from '@waypoint/folder-host'
import { loadBundledWaypointCatalog, installQuestCatalog, initWaypointProject, startQuestRoute } from '@waypoint/folder-host'
import type {
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
} from '@waypoint/folder-host'

import { runGasCityCommand, type WaypointGasCityCommandRuntime } from './gascity.ts'

describe('waypoint gascity command', () => {
  it('prints JSON diagnostics with concrete recovery guidance', async () => {
    const cwd = await tempProject()
    await startQuestRoute(cwd, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRuntime({
      sessions: [{ id: 'codex-creating-001', status: 'creating', target: 'waypoint/codex', ageSeconds: 900, raw: {} }],
      events: [],
    })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
    })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(
      ['diagnose', '--route-id', 'route-001', '--target', 'waypoint/codex', '--json'],
      io,
      {
        createRuntime: () => runtime,
        issueReader,
      },
    )

    expect(code).toBe(1)
    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { ok: boolean; diagnostics: Array<{ code: string; guidance: string[] }> }
    expect(parsed.ok).toBe(false)
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-route-metadata-missing',
      'gascity-worker-stuck-creating',
    ])
    expect(parsed.diagnostics[0]?.guidance.join('\n')).toContain('bd update bd-002 --set-metadata gc.routed_to=waypoint/codex')
  })

  it('prints failed preflight checks without throwing', async () => {
    const cwd = await tempProject()
    const runtime = createRuntime({ preflightOk: false, sessions: [], events: [] })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(['preflight'], io, { createRuntime: () => runtime })

    expect(code).toBe(1)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Gas City preflight: failed')
    expect(stdout.join('\n')).toContain('guidance: Install Gas City.')
  })

  it('retries Gas City sling for an existing Beads-backed route without starting another route', async () => {
    const cwd = await tempProject()
    await startQuestRoute(cwd, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRuntime({ sessions: [], events: [] })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
      routedMetadata: {
        'gc.routed_to': 'waypoint/codex',
        molecule_id: 'wpg-9ay',
      },
    })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(
      ['sling', '--route-id', 'route-001', '--target', 'waypoint/codex', '--json'],
      io,
      {
        createRuntime: () => runtime,
        issueReader,
      },
    )

    expect(code).toBe(0)
    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      ok: boolean
      action: string
      beadId: string
      routedBeadId: string
      convoy: { convoyId: string }
      metadata: { ok: boolean }
    }
    expect(parsed).toMatchObject({
      ok: true,
      action: 'gascity.sling',
      beadId: 'bd-001',
      routedBeadId: 'bd-002',
      convoy: { convoyId: 'gc-convoy-001' },
      metadata: { ok: true },
    })
    expect(runtime.convoyCalls).toEqual([
      expect.objectContaining({
        name: 'waypoint-route-001',
        issueIds: ['bd-002'],
      }),
    ])
    expect(runtime.slingCalls).toEqual([
      expect.objectContaining({
        target: 'waypoint/codex',
        beadId: 'gc-convoy-001',
        noFormula: true,
        nudge: true,
      }),
    ])
  })

  it('routes no-nudge sling through Beads metadata without calling Gas City sling', async () => {
    const cwd = await tempProject()
    await startQuestRoute(cwd, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRuntime({ sessions: [], events: [] })
    const issueReader = createMutableIssueReader({
      id: 'bd-001',
      title: 'Waypoint route',
      status: 'open',
      metadata: {
        waypoint: { route_id: 'route-001' },
      },
    })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(
      ['sling', '--route-id', 'route-001', '--target', 'waypoint/codex', '--no-nudge', '--json'],
      io,
      {
        createRuntime: () => runtime,
        issueReader,
      },
    )

    expect(code).toBe(0)
    expect(stderr).toEqual([])
    expect(runtime.slingCalls).toEqual([])
    expect(issueReader.metadataUpdates).toEqual([
      {
        id: 'bd-001',
        metadata: { 'gc.routed_to': 'waypoint/codex' },
      },
    ])
    const parsed = JSON.parse(stdout.join('\n')) as {
      ok: boolean
      action: string
      sling: { mode: string }
      metadata: { ok: boolean; routedTo: string }
    }
    expect(parsed).toMatchObject({
      ok: true,
      action: 'gascity.sling',
      sling: { mode: 'metadata-only' },
      metadata: { ok: true, routedTo: 'waypoint/codex' },
    })
  })

  it('reports missing route metadata after retry sling', async () => {
    const cwd = await tempProject()
    await startQuestRoute(cwd, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRuntime({ sessions: [], events: [] })
    const issueReader = createRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
    })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(
      ['sling', '--route-id', 'route-001', '--target', 'waypoint/codex', '--json'],
      io,
      {
        createRuntime: () => runtime,
        issueReader,
      },
    )

    expect(code).toBe(1)
    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('bd update bd-002 --set-metadata gc.routed_to=waypoint/codex')
  })

  it('repairs route metadata only when explicitly requested', async () => {
    const cwd = await tempProject()
    await startQuestRoute(cwd, { quest: 'waypoint', beadsClient: createRecordingClient() })
    const runtime = createRuntime({ sessions: [], events: [] })
    const issueReader = createMutableRouteIssueReader({
      id: 'bd-001',
      routedId: 'bd-002',
      routedStatus: 'open',
    })
    const { io, stdout, stderr } = makeIo(cwd)

    const code = await runGasCityCommand(
      ['sling', '--route-id', 'route-001', '--target', 'waypoint/codex', '--repair-metadata', '--json'],
      io,
      {
        createRuntime: () => runtime,
        issueReader,
      },
    )

    expect(code).toBe(0)
    expect(stderr).toEqual([])
    expect(issueReader.metadataUpdates).toEqual([
      {
        id: 'bd-002',
        metadata: { 'gc.routed_to': 'waypoint/codex' },
      },
    ])
    const parsed = JSON.parse(stdout.join('\n')) as { ok: boolean; metadata: { ok: boolean; routedTo: string } }
    expect(parsed).toMatchObject({ ok: true, metadata: { ok: true, routedTo: 'waypoint/codex' } })
  })
})

async function tempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-cli-gascity-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint', backend: 'beads' })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  return projectRoot
}

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
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

function createRouteIssueReader(input: {
  readonly id: string
  readonly routedId: string
  readonly routedStatus: string
  readonly routedAssignee?: string
  readonly routedMetadata?: Record<string, unknown>
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return {
        issues: routeIssues(input),
        dependencies: [],
      }
    },
  }
}

function createMutableRouteIssueReader(input: {
  readonly id: string
  readonly routedId: string
  readonly routedStatus: string
  readonly routedAssignee?: string
  readonly routedMetadata?: Record<string, unknown>
}): WaypointBeadsIssueSnapshotReader & {
  readonly metadataUpdates: Array<{ id: string; metadata: Readonly<Record<string, string>> }>
  updateIssueMetadata(input: { readonly id: string; readonly metadata: Readonly<Record<string, string>> }): Promise<void>
} {
  const metadataUpdates: Array<{ id: string; metadata: Readonly<Record<string, string>> }> = []
  const issues = routeIssues(input)
  return {
    metadataUpdates,
    async listIssueSnapshots() {
      return {
        issues,
        dependencies: [],
      }
    },
    async updateIssueMetadata(input) {
      metadataUpdates.push(input)
      const issue = issues.find((candidate) => candidate.id === input.id)
      if (issue) issue.metadata = { ...(isRecord(issue.metadata) ? issue.metadata : {}), ...input.metadata }
    },
  }
}

function routeIssues(input: {
  readonly id: string
  readonly routedId: string
  readonly routedStatus: string
  readonly routedAssignee?: string
  readonly routedMetadata?: Record<string, unknown>
}) {
  return [
    {
      id: input.id,
      title: 'Waypoint route',
      status: 'open',
      issue_type: 'epic',
      metadata: waypointMetadata('route'),
    },
    {
      id: input.routedId,
      title: 'Gather project context and starting constraints',
      status: input.routedStatus,
      issue_type: 'task',
      ...(input.routedAssignee ? { assignee: input.routedAssignee } : {}),
      metadata: {
        ...input.routedMetadata,
        waypoint: waypointMetadata('checkpoint', 'initialize-context').waypoint,
      },
    },
  ]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createRuntime(input: {
  readonly preflightOk?: boolean
  readonly sessions: Awaited<ReturnType<WaypointGasCityDiagnosticsRuntime['listSessions']>>['sessions']
  readonly events: Awaited<ReturnType<WaypointGasCityDiagnosticsRuntime['readEvents']>>['events']
}): WaypointGasCityCommandRuntime & {
  readonly convoyCalls: WaypointGasCityCreateConvoyInput[]
  readonly slingCalls: WaypointGasCitySlingBeadInput[]
} {
  const convoyCalls: WaypointGasCityCreateConvoyInput[] = []
  const slingCalls: WaypointGasCitySlingBeadInput[] = []
  return {
    convoyCalls,
    slingCalls,
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
      return { sessions: input.sessions, raw: input.sessions }
    },
    async readEvents() {
      return { events: input.events, raw: input.events.map((event) => JSON.stringify(event)).join('\n') }
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
    async slingBead(input): Promise<WaypointGasCitySlingResult> {
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
