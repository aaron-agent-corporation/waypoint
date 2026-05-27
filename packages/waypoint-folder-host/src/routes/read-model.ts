import { readWaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import {
  reconstructWaypointRunFromBeads,
  type ReconstructWaypointRunFromBeadsInput,
  type WaypointBeadsIssueSnapshot,
  type WaypointBeadsRunReconstruction,
} from '../beads/reconstruct.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import type { WaypointFolderTask, WaypointFolderTaskKind } from '../tasks/types.ts'
import { getWaypointRoute, listWaypointRoutes } from './store.ts'
import type { WaypointFolderRoute } from './types.ts'

export interface WaypointRuntimeReadOptions {
  readonly beadsReader?: WaypointBeadsIssueSnapshotReader
}

export interface ListWaypointRuntimeTasksOptions extends WaypointRuntimeReadOptions {
  readonly routeId?: string | null
}

export async function listWaypointRuntimeRoutes(
  projectRoot: string,
  options: WaypointRuntimeReadOptions = {},
): Promise<WaypointFolderRoute[]> {
  const backend = await readRouteBackend(projectRoot)
  if (backend === 'folder') return listWaypointRoutes(projectRoot)

  const snapshot = await readBeadsSnapshot(projectRoot, options)
  return reconstructAllBeadsRoutes(snapshot).map(routeFromBeadsRun)
}

export async function getWaypointRuntimeRoute(
  projectRoot: string,
  routeId: string,
  options: WaypointRuntimeReadOptions = {},
): Promise<WaypointFolderRoute | null> {
  const backend = await readRouteBackend(projectRoot)
  if (backend === 'folder') return getWaypointRoute(projectRoot, routeId)

  const snapshot = await readBeadsSnapshot(projectRoot, options)
  try {
    return routeFromBeadsRun(reconstructWaypointRunFromBeads({ ...snapshot, routeId }))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No Waypoint Beads route found')) return null
    throw error
  }
}

export async function listWaypointRuntimeTasks(
  projectRoot: string,
  options: ListWaypointRuntimeTasksOptions = {},
): Promise<WaypointFolderTask[]> {
  const backend = await readRouteBackend(projectRoot)
  if (backend === 'folder') {
    const tasks = await listWaypointTasks(projectRoot)
    return options.routeId ? tasks.filter((task) => task.route_id === options.routeId) : tasks
  }

  const snapshot = await readBeadsSnapshot(projectRoot, options)
  const runs = options.routeId
    ? reconstructBeadsRouteIfPresent(snapshot, options.routeId)
    : reconstructAllBeadsRoutes(snapshot)
  return runs.flatMap((run) => run.tasks.map(taskFromBeadsRunTask))
}

export async function getWaypointRuntimeTask(
  projectRoot: string,
  taskId: string,
  options: WaypointRuntimeReadOptions = {},
): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointRuntimeTasks(projectRoot, options)
  return tasks.find((task) => task.id === taskId) ?? null
}

async function readRouteBackend(projectRoot: string): Promise<WaypointRouteBackendMode> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return config.backend.route
  } catch (error) {
    if (isNotFoundError(error)) return 'folder'
    throw error
  }
}

async function readBeadsSnapshot(
  projectRoot: string,
  options: WaypointRuntimeReadOptions,
): Promise<ReconstructWaypointRunFromBeadsInput> {
  const reader = options.beadsReader ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  return reader.listIssueSnapshots()
}

function reconstructAllBeadsRoutes(snapshot: ReconstructWaypointRunFromBeadsInput): WaypointBeadsRunReconstruction[] {
  return routeIdsFromSnapshot(snapshot.issues).map((routeId) => reconstructWaypointRunFromBeads({ ...snapshot, routeId }))
}

function reconstructBeadsRouteIfPresent(
  snapshot: ReconstructWaypointRunFromBeadsInput,
  routeId: string,
): WaypointBeadsRunReconstruction[] {
  try {
    return [reconstructWaypointRunFromBeads({ ...snapshot, routeId })]
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No Waypoint Beads route found')) return []
    throw error
  }
}

function routeFromBeadsRun(run: WaypointBeadsRunReconstruction): WaypointFolderRoute {
  return {
    id: run.route.id,
    quest: run.route.quest,
    status: run.route.status,
    current_node: run.route.current_node,
    subject: run.route.subject,
    created_at: run.route.created_at ?? '',
    updated_at: run.route.updated_at ?? '',
    metadata: {
      waypoint: run.route.metadata.waypoint,
      beads: {
        issue_id: run.route.beads_id,
        progress: run.route.progress,
      },
      backend: {
        route: 'beads',
      },
    },
  }
}

function taskFromBeadsRunTask(task: WaypointBeadsRunReconstruction['tasks'][number]): WaypointFolderTask {
  return {
    id: task.beads_id,
    route_id: task.route_id,
    plan_ref: task.plan_ref,
    title: task.title,
    phase: task.phase ?? 'unknown',
    wave: task.wave,
    kind: waypointFolderTaskKind(task.kind),
    status: task.status,
    created_at: task.created_at ?? '',
    updated_at: task.updated_at ?? '',
    metadata: {
      waypoint: task.metadata.waypoint,
      beads: {
        issue_id: task.beads_id,
        blockers: task.blockers,
      },
    },
  }
}

function routeIdsFromSnapshot(issues: readonly WaypointBeadsIssueSnapshot[]): readonly string[] {
  return [
    ...new Set(
      issues
        .map((issue) => routeIdFromIssue(issue))
        .filter((routeId): routeId is string => Boolean(routeId))
        .sort(),
    ),
  ]
}

function routeIdFromIssue(issue: WaypointBeadsIssueSnapshot): string | null {
  const metadata = metadataRecord(issue.metadata)
  const waypoint = isRecord(metadata?.waypoint) ? metadata.waypoint : null
  if (waypoint?.kind !== 'route') return null
  return typeof waypoint.route_id === 'string' ? waypoint.route_id : null
}

function waypointFolderTaskKind(kind: string): WaypointFolderTaskKind {
  return isWaypointFolderTaskKind(kind) ? kind : 'node'
}

function isWaypointFolderTaskKind(value: string): value is WaypointFolderTaskKind {
  return (
    value === 'recipe' ||
    value === 'discussion' ||
    value === 'gate' ||
    value === 'checkpoint' ||
    value === 'wait' ||
    value === 'handoff' ||
    value === 'artifact' ||
    value === 'node' ||
    value === 'delay' ||
    value === 'timer' ||
    value === 'dependency' ||
    value === 'system'
  )
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (isRecord(metadata)) return metadata
  if (typeof metadata !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
