import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsIssueSnapshot } from '../beads/reconstruct.ts'
import { readRouteEvents } from '../events/jsonl.ts'
import { getWaypointRoute } from '../routes/store.ts'
import {
  diagnoseWaypointGasCityState,
  type WaypointGasCityDiagnostic,
  type WaypointGasCityEventPage,
  type WaypointGasCityEventsInput,
  type WaypointGasCityPreflight,
  type WaypointGasCityPreflightInput,
  type WaypointGasCitySessionList,
  type WaypointGasCitySessionListInput,
} from './cli-adapter.ts'
import { selectWaypointGasCityRoutableTask } from './routing.ts'

export interface WaypointGasCityDiagnosticsRuntime {
  preflight(input?: WaypointGasCityPreflightInput): Promise<WaypointGasCityPreflight>
  listSessions(input?: WaypointGasCitySessionListInput): Promise<WaypointGasCitySessionList>
  readEvents(input?: WaypointGasCityEventsInput): Promise<WaypointGasCityEventPage>
}

export interface InspectWaypointGasCityRouteInput {
  readonly projectRoot: string
  readonly routeId: string
  readonly target: string
  readonly runtime: WaypointGasCityDiagnosticsRuntime
  readonly provider?: string
  readonly issueReader?: WaypointBeadsIssueSnapshotReader
  readonly eventSince?: string
}

export interface InspectWaypointGasCityRouteResult {
  readonly routeId: string
  readonly target: string
  readonly beadId: string
  readonly routedBeadId: string
  readonly preflight: WaypointGasCityPreflight
  readonly task: WaypointGasCityTaskDiagnosticSnapshot
  readonly sessions: WaypointGasCitySessionList
  readonly events: WaypointGasCityEventPage
  readonly diagnostics: readonly WaypointGasCityDiagnostic[]
}

export interface WaypointGasCityTaskDiagnosticSnapshot {
  readonly id: string
  readonly status: string
  readonly assignee?: string
  readonly startedAt?: string
  readonly closedAt?: string
  readonly notes?: string
  readonly metadata?: Record<string, unknown>
}

export async function inspectWaypointGasCityRoute(
  input: InspectWaypointGasCityRouteInput,
): Promise<InspectWaypointGasCityRouteResult> {
  const route = await getWaypointRoute(input.projectRoot, input.routeId)
  if (!route) throw new Error(`Waypoint route not found: ${input.routeId}`)
  if (routeBackendFromMetadata(route.metadata) !== 'beads') {
    throw new Error('Gas City diagnostics require a Beads-backed Waypoint route.')
  }

  const beadId = rootBeadsIssueId(route.metadata)
  if (!beadId) {
    throw new Error(`Waypoint route ${input.routeId} does not record a Beads root issue id.`)
  }

  const issueReader = input.issueReader ?? new WaypointBeadsCliIssueClient({ cwd: input.projectRoot })
  const snapshots = await issueReader.listIssueSnapshots()
  const rootIssue = snapshots.issues.find((issue) => issue.id === beadId)
  if (!rootIssue) {
    throw new Error(`Beads root issue not found for route ${input.routeId}: ${beadId}`)
  }
  const run = reconstructWaypointRunFromBeads({
    routeId: input.routeId,
    issues: snapshots.issues,
    dependencies: snapshots.dependencies,
  })
  const currentTask = run.route.current_node ? run.tasks.find((task) => task.plan_ref === run.route.current_node) : undefined
  const routedTask = currentTask && currentTask.kind !== 'gate' && currentTask.kind !== 'wait'
    ? currentTask
    : selectWaypointGasCityRoutableTask(run.tasks, run.route.current_node)
  const routedIssue = routedTask ? snapshots.issues.find((issue) => issue.id === routedTask.beads_id) : undefined
  const delegatedIssue = await latestGasCityDelegatedIssue({
    projectRoot: input.projectRoot,
    routeId: input.routeId,
    issues: snapshots.issues,
  })
  const diagnosticIssue = delegatedIssue ?? routedIssue ?? rootIssue

  const preflight = await input.runtime.preflight({ provider: input.provider })
  const sessions = preflight.ok ? await input.runtime.listSessions({ state: 'all' }) : { sessions: [], raw: [] }
  const events = preflight.ok ? await input.runtime.readEvents({ since: input.eventSince ?? '1h' }) : { events: [], raw: '' }
  const task = taskSnapshotFromIssue(diagnosticIssue)
  const diagnostics = diagnoseWaypointGasCityState({
    expectedTarget: input.target,
    expectedMoleculeId: stringMetadata(diagnosticIssue.metadata, 'molecule_id') ?? undefined,
    task,
    sessions: sessions.sessions.map((session) => ({
      id: session.id,
      status: session.status,
      name: session.name,
      target: session.target,
      template: session.template,
      alias: session.alias,
      agentName: session.agentName,
      sessionName: session.sessionName,
      drainReason: session.drainReason,
      ageSeconds: session.ageSeconds,
    })),
    events: events.events.map((event) => ({
      type: stringField(event, 'type') ?? stringField(event, 'kind') ?? undefined,
      message: stringField(event, 'message') ?? stringField(event, 'event') ?? undefined,
      payload: event.payload,
    })),
  })

  return {
    routeId: input.routeId,
    target: input.target,
    beadId,
    routedBeadId: diagnosticIssue.id,
    preflight,
    task,
    sessions,
    events,
    diagnostics,
  }
}

function taskSnapshotFromIssue(issue: WaypointBeadsIssueSnapshot): WaypointGasCityTaskDiagnosticSnapshot {
  const metadata = isRecord(issue.metadata) ? issue.metadata : undefined
  return {
    id: issue.id,
    status: issue.status,
    ...(issue.assignee ? { assignee: issue.assignee } : {}),
    ...(issue.started_at ? { startedAt: issue.started_at } : {}),
    ...(issue.closed_at ? { closedAt: issue.closed_at } : {}),
    ...(issue.notes ? { notes: issue.notes } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

function routeBackendFromMetadata(metadata: Record<string, unknown> | undefined): string | null {
  const backend = isRecord(metadata?.backend) ? metadata.backend : {}
  return typeof backend.route === 'string' ? backend.route : null
}

function rootBeadsIssueId(metadata: Record<string, unknown> | undefined): string | null {
  const beads = isRecord(metadata?.beads) ? metadata.beads : {}
  return typeof beads.root_issue_id === 'string' ? beads.root_issue_id : null
}

function stringMetadata(metadata: unknown, key: string): string | null {
  return isRecord(metadata) && typeof metadata[key] === 'string' ? metadata[key] : null
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

async function latestGasCityDelegatedIssue(input: {
  readonly projectRoot: string
  readonly routeId: string
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
}): Promise<WaypointBeadsIssueSnapshot | undefined> {
  const events = await readRouteEvents(input.projectRoot, input.routeId, { limit: 1000 })
  for (const event of [...events.items].reverse()) {
    if (event.kind !== 'route.runtime.delegated' || !isRecord(event.payload)) continue
    if (event.payload.runtime !== 'gascity') continue
    if (event.payload.dry_run === true) continue
    const routedBeadId = stringField(event.payload, 'routed_bead_id')
      ?? (stringField(event.payload, 'delegation_mode') === 'metadata-only' ? stringField(event.payload, 'bead_id') : null)
    if (!routedBeadId) continue
    const issue = input.issues.find((candidate) => candidate.id === routedBeadId)
    if (issue) return issue
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
