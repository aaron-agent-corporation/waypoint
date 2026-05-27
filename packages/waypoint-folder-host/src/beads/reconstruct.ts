import type { WaypointBeadsIssueKind, WaypointBeadsMetadata, WaypointBeadsSubject } from './compiler.ts'

export type WaypointBeadsSnapshotStatus =
  | 'open'
  | 'in_progress'
  | 'hooked'
  | 'blocked'
  | 'deferred'
  | 'closed'
  | 'pinned'
  | 'failed'
  | 'cancelled'
  | string

export type WaypointBeadsRunStatus = 'active' | 'blocked' | 'complete' | 'failed' | 'cancelled'
export type WaypointBeadsRunTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'failed'

export interface WaypointBeadsIssueDependencySnapshot {
  readonly id?: string
  readonly issue_id?: string
  readonly depends_on_id?: string
  readonly dependency_type?: string
  readonly type?: string
  readonly status?: WaypointBeadsSnapshotStatus
}

export interface WaypointBeadsIssueSnapshot {
  readonly id: string
  readonly title: string
  readonly status: WaypointBeadsSnapshotStatus
  readonly issue_type?: string
  readonly created_at?: string
  readonly updated_at?: string
  readonly metadata?: unknown
  readonly parent?: string
  readonly dependencies?: readonly WaypointBeadsIssueDependencySnapshot[]
}

export interface WaypointBeadsDependencySnapshot {
  readonly issue_id: string
  readonly depends_on_id: string
  readonly type?: string
}

export interface ReconstructWaypointRunFromBeadsInput {
  readonly routeId?: string
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies?: readonly WaypointBeadsDependencySnapshot[]
}

export interface WaypointBeadsRunTask {
  readonly id: string
  readonly beads_id: string
  readonly route_id: string
  readonly plan_ref: string
  readonly title: string
  readonly phase: string | null
  readonly wave: number | null
  readonly sequence: number | null
  readonly kind: WaypointBeadsIssueKind
  readonly status: WaypointBeadsRunTaskStatus
  readonly blockers: readonly string[]
  readonly metadata: WaypointBeadsMetadata
  readonly created_at?: string
  readonly updated_at?: string
}

export interface WaypointBeadsRunProgress {
  readonly total: number
  readonly open: number
  readonly in_progress: number
  readonly blocked: number
  readonly done: number
  readonly failed: number
  readonly ready: number
}

export interface WaypointBeadsRouteRun {
  readonly id: string
  readonly beads_id: string
  readonly quest: string
  readonly status: WaypointBeadsRunStatus
  readonly current_node: string | null
  readonly subject: WaypointBeadsSubject
  readonly created_at?: string
  readonly updated_at?: string
  readonly metadata: WaypointBeadsMetadata
  readonly progress: WaypointBeadsRunProgress
}

export interface WaypointBeadsRunReconstruction {
  readonly route: WaypointBeadsRouteRun
  readonly tasks: readonly WaypointBeadsRunTask[]
}

export function reconstructWaypointRunFromBeads(
  input: ReconstructWaypointRunFromBeadsInput,
): WaypointBeadsRunReconstruction {
  const waypointIssues = input.issues
    .map((issue) => ({ issue, metadata: waypointMetadataFromIssue(issue) }))
    .filter((entry): entry is { issue: WaypointBeadsIssueSnapshot; metadata: WaypointBeadsMetadata } => Boolean(entry.metadata))

  const root = selectRouteRoot(waypointIssues, input.routeId)
  const routeId = root.metadata.waypoint.route_id
  const issueById = new Map(input.issues.map((issue) => [issue.id, issue]))
  const dependencies = collectDependencies(input)
  const openBlockersByIssue = openBlockersByIssueId(dependencies, issueById)

  const tasks = waypointIssues
    .filter((entry) => entry.metadata.waypoint.route_id === routeId && entry.metadata.waypoint.kind !== 'route')
    .map((entry) => runTaskFromIssue(entry.issue, entry.metadata, openBlockersByIssue.get(entry.issue.id) ?? []))
    .sort(compareRunTasks)

  const progress = progressForTasks(tasks)
  const currentNode = tasks.find((task) => task.status !== 'done')?.plan_ref ?? null
  const status = routeStatus(root.issue.status, tasks, progress)

  return {
    route: {
      id: routeId,
      beads_id: root.issue.id,
      quest: root.metadata.waypoint.quest_slug,
      status,
      current_node: currentNode,
      subject: root.metadata.waypoint.subject,
      ...(root.issue.created_at ? { created_at: root.issue.created_at } : {}),
      ...(root.issue.updated_at ? { updated_at: root.issue.updated_at } : {}),
      metadata: root.metadata,
      progress,
    },
    tasks,
  }
}

function selectRouteRoot(
  issues: readonly { readonly issue: WaypointBeadsIssueSnapshot; readonly metadata: WaypointBeadsMetadata }[],
  routeId: string | undefined,
): { readonly issue: WaypointBeadsIssueSnapshot; readonly metadata: WaypointBeadsMetadata } {
  const roots = issues.filter(
    (entry) => entry.metadata.waypoint.kind === 'route' && (!routeId || entry.metadata.waypoint.route_id === routeId),
  )
  if (roots.length === 0) {
    throw new Error(routeId ? `No Waypoint Beads route found for ${routeId}` : 'No Waypoint Beads route found')
  }
  if (roots.length > 1) {
    throw new Error('Multiple Waypoint Beads routes found; pass routeId to disambiguate')
  }
  return roots[0]!
}

function runTaskFromIssue(
  issue: WaypointBeadsIssueSnapshot,
  metadata: WaypointBeadsMetadata,
  blockers: readonly string[],
): WaypointBeadsRunTask {
  const scaffold = metadata.waypoint.scaffold
  return {
    id: issue.id,
    beads_id: issue.id,
    route_id: metadata.waypoint.route_id,
    plan_ref: metadata.waypoint.node_key ?? scaffold?.plan_ref ?? issue.id,
    title: issue.title,
    phase: scaffold?.phase ?? null,
    wave: scaffold?.wave ?? null,
    sequence: scaffold?.sequence ?? null,
    kind: metadata.waypoint.kind,
    status: taskStatus(issue.status, blockers),
    blockers,
    metadata,
    ...(issue.created_at ? { created_at: issue.created_at } : {}),
    ...(issue.updated_at ? { updated_at: issue.updated_at } : {}),
  }
}

function taskStatus(status: WaypointBeadsSnapshotStatus, blockers: readonly string[]): WaypointBeadsRunTaskStatus {
  if (status === 'closed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'in_progress' || status === 'hooked') return 'in_progress'
  if (status === 'blocked' || status === 'deferred' || status === 'pinned') return 'blocked'
  if (blockers.length > 0) return 'blocked'
  return 'open'
}

function routeStatus(
  rootStatus: WaypointBeadsSnapshotStatus,
  tasks: readonly WaypointBeadsRunTask[],
  progress: WaypointBeadsRunProgress,
): WaypointBeadsRunStatus {
  if (rootStatus === 'cancelled') return 'cancelled'
  if (rootStatus === 'failed' || progress.failed > 0) return 'failed'
  if (rootStatus === 'blocked' || rootStatus === 'deferred' || rootStatus === 'pinned') return 'blocked'
  if (tasks.length === 0) return rootStatus === 'closed' ? 'complete' : 'active'
  if (progress.done === tasks.length) return 'complete'
  if (tasks.some((task) => task.status === 'in_progress')) return 'active'

  const readyTasks = tasks.filter((task) => task.status === 'open' && task.blockers.length === 0)
  if (readyTasks.some((task) => task.kind !== 'gate' && task.kind !== 'wait')) {
    return 'active'
  }
  if (readyTasks.length > 0 || progress.blocked > 0) {
    return 'blocked'
  }
  return 'active'
}

function progressForTasks(tasks: readonly WaypointBeadsRunTask[]): WaypointBeadsRunProgress {
  return {
    total: tasks.length,
    open: tasks.filter((task) => task.status === 'open').length,
    in_progress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    done: tasks.filter((task) => task.status === 'done').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    ready: tasks.filter((task) => task.status === 'open' && task.blockers.length === 0).length,
  }
}

function compareRunTasks(left: WaypointBeadsRunTask, right: WaypointBeadsRunTask): number {
  const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER
  const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER
  const leftWave = left.wave ?? Number.MAX_SAFE_INTEGER
  const rightWave = right.wave ?? Number.MAX_SAFE_INTEGER
  return leftSequence - rightSequence || leftWave - rightWave || left.plan_ref.localeCompare(right.plan_ref) || left.id.localeCompare(right.id)
}

function collectDependencies(input: ReconstructWaypointRunFromBeadsInput): WaypointBeadsDependencySnapshot[] {
  const dependencies: WaypointBeadsDependencySnapshot[] = []
  const seen = new Set<string>()
  for (const dependency of input.dependencies ?? []) {
    pushDependency(dependencies, seen, dependency)
  }
  for (const issue of input.issues) {
    for (const dependency of issue.dependencies ?? []) {
      if (dependency.issue_id && dependency.depends_on_id) {
        pushDependency(dependencies, seen, {
          issue_id: dependency.issue_id,
          depends_on_id: dependency.depends_on_id,
          type: dependency.type ?? dependency.dependency_type,
        })
      } else if (dependency.id) {
        pushDependency(dependencies, seen, {
          issue_id: issue.id,
          depends_on_id: dependency.id,
          type: dependency.dependency_type ?? dependency.type,
        })
      }
    }
  }
  return dependencies
}

function pushDependency(
  dependencies: WaypointBeadsDependencySnapshot[],
  seen: Set<string>,
  dependency: WaypointBeadsDependencySnapshot,
): void {
  const key = `${dependency.issue_id}\u0000${dependency.depends_on_id}\u0000${dependency.type ?? ''}`
  if (seen.has(key)) return
  seen.add(key)
  dependencies.push(dependency)
}

function openBlockersByIssueId(
  dependencies: readonly WaypointBeadsDependencySnapshot[],
  issueById: ReadonlyMap<string, WaypointBeadsIssueSnapshot>,
): ReadonlyMap<string, readonly string[]> {
  const blockersByIssue = new Map<string, string[]>()
  for (const dependency of dependencies) {
    if (dependency.type && dependency.type !== 'blocks') continue
    if (isClosedStatus(issueById.get(dependency.depends_on_id)?.status)) continue
    const blockers = blockersByIssue.get(dependency.issue_id) ?? []
    blockers.push(dependency.depends_on_id)
    blockersByIssue.set(dependency.issue_id, blockers)
  }
  return blockersByIssue
}

function isClosedStatus(status: WaypointBeadsSnapshotStatus | undefined): boolean {
  return status === 'closed'
}

function waypointMetadataFromIssue(issue: WaypointBeadsIssueSnapshot): WaypointBeadsMetadata | undefined {
  const metadata = parseMetadata(issue.metadata)
  const waypoint = asRecord(metadata?.waypoint)
  if (
    !waypoint ||
    waypoint.schema_version !== 1 ||
    !isWaypointKind(waypoint.kind) ||
    typeof waypoint.quest_slug !== 'string' ||
    typeof waypoint.route_id !== 'string' ||
    !isSubject(waypoint.subject)
  ) {
    return undefined
  }
  return metadata as unknown as WaypointBeadsMetadata
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return undefined
    }
  }
  return asRecord(value)
}

function isWaypointKind(value: unknown): value is WaypointBeadsIssueKind {
  return (
    value === 'route' ||
    value === 'recipe' ||
    value === 'gate' ||
    value === 'wait' ||
    value === 'handoff' ||
    value === 'artifact' ||
    value === 'checkpoint' ||
    value === 'discussion' ||
    value === 'node'
  )
}

function isSubject(value: unknown): value is WaypointBeadsSubject {
  const subject = asRecord(value)
  return typeof subject?.type === 'string' && typeof subject.id === 'string'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
