import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'
import { getWaypointRoute, listWaypointRoutes } from './store.ts'
import type { WaypointFolderRoute } from './types.ts'

export interface ListWaypointRuntimeTasksOptions {
  readonly routeId?: string | null
}

// folder and postgres share the runtime read path — the store layer
// dispatches on backend.
export async function listWaypointRuntimeRoutes(projectRoot: string): Promise<WaypointFolderRoute[]> {
  return listWaypointRoutes(projectRoot)
}

export async function getWaypointRuntimeRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute | null> {
  return getWaypointRoute(projectRoot, routeId)
}

export async function listWaypointRuntimeTasks(
  projectRoot: string,
  options: ListWaypointRuntimeTasksOptions = {},
): Promise<WaypointFolderTask[]> {
  const tasks = await listWaypointTasks(projectRoot)
  return options.routeId ? tasks.filter((task) => task.route_id === options.routeId) : tasks
}

export async function getWaypointRuntimeTask(projectRoot: string, taskId: string): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointRuntimeTasks(projectRoot)
  return tasks.find((task) => task.id === taskId) ?? null
}

/** One attempt currently queued or in flight. */
export interface WaypointOpenDispatch {
  readonly route_id: string
  readonly task_ref: string
  readonly status: 'queued' | 'running'
}

/**
 * Every dispatch a bridge is holding or working right now.
 *
 * A task's status is the LAST recorded outcome, so it reads `failed` from
 * attempt one while the bounded auto re-dispatch's attempt two is actively
 * running — and every consumer that judged runs by task status alone filed a
 * live run under Failed (Aaron 2026-08-14: the board's Running lane was empty
 * while a chronology QC retry had been running for an hour). This is the read
 * that tells a retrying run from a stopped one. Fails open to an empty list:
 * an unreadable dispatch table must not take the whole listing down with it.
 */
export async function listWaypointRuntimeOpenDispatches(projectRoot: string): Promise<WaypointOpenDispatch[]> {
  try {
    const { pool, schema } = await getWaypointPostgres(projectRoot)
    const result = await pool.query(
      `SELECT route_id, task_ref, status FROM ${quoteIdent(schema)}.dispatches WHERE status IN ('queued', 'running')`,
    )
    return (result.rows as WaypointOpenDispatch[]).filter(
      (row) => typeof row.route_id === 'string' && typeof row.task_ref === 'string',
    )
  } catch {
    return []
  }
}
