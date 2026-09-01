import { getWaypointPostgres, quoteIdent } from './client.ts'

import type pg from 'pg'
import type { AppendRouteEventInput, ReadRouteEventsOptions, RouteEventPage, WaypointFolderRouteEvent } from '../events/types.ts'
import type { CreateWaypointRouteInput, WaypointFolderRoute } from '../routes/types.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'

/**
 * Postgres implementations of the route/task/event stores (P1 of the
 * pg_durable substrate track). Semantics mirror the folder stores exactly —
 * same id numbering, same patch spread behavior, same error messages — so the
 * autopilot, route state machine, and engine commands run unchanged on either
 * backend. Only reached via the dispatch guards in routes/store.ts,
 * tasks/store.ts, and events/jsonl.ts when backend.route is 'postgres'.
 */

// ---------------------------------------------------------------------------
// routes

export async function createWaypointRoutePg(projectRoot: string, input: CreateWaypointRouteInput): Promise<WaypointFolderRoute> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const timestamp = timestampFor(input.now)

  return withTransaction(pool, async (client) => {
    const existing = await selectRoutes(client, schema)
    if (input.id && existing.some((route) => route.id === input.id)) {
      throw new Error(`Route already exists: ${input.id}`)
    }
    const route: WaypointFolderRoute = {
      id: input.id ?? nextRouteId(existing),
      quest: input.quest,
      status: input.status ?? 'active',
      current_node: input.current_node ?? null,
      subject: input.subject,
      created_at: timestamp,
      updated_at: timestamp,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }
    await client.query(
      `INSERT INTO ${quoteIdent(schema)}.routes (id, quest, status, current_node, subject, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        route.id,
        route.quest,
        route.status,
        route.current_node,
        JSON.stringify(route.subject),
        route.metadata === undefined ? null : JSON.stringify(route.metadata),
        route.created_at,
        route.updated_at,
      ],
    )
    return route
  })
}

export async function listWaypointRoutesPg(projectRoot: string): Promise<WaypointFolderRoute[]> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  return selectRoutes(pool, schema)
}

export async function getWaypointRoutePg(projectRoot: string, routeId: string): Promise<WaypointFolderRoute | null> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const result = await pool.query(`SELECT * FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [routeId])
  return result.rows.length > 0 ? routeFromRow(result.rows[0]) : null
}

export async function updateWaypointRoutePg(
  projectRoot: string,
  routeId: string,
  patch: Partial<Pick<WaypointFolderRoute, 'status' | 'current_node' | 'updated_at' | 'metadata'>>,
): Promise<WaypointFolderRoute> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)

  return withTransaction(pool, async (client) => {
    const result = await client.query(`SELECT * FROM ${quoteIdent(schema)}.routes WHERE id = $1 FOR UPDATE`, [routeId])
    if (result.rows.length === 0) throw new Error(`Route not found: ${routeId}`)
    // Merge in JS to preserve the folder store's spread semantics exactly:
    // absent patch keys keep existing values; explicit null current_node clears.
    const updated: WaypointFolderRoute = { ...routeFromRow(result.rows[0]), ...patch }
    await client.query(
      `UPDATE ${quoteIdent(schema)}.routes
       SET status = $2, current_node = $3, metadata = $4::jsonb, updated_at = $5
       WHERE id = $1`,
      [
        routeId,
        updated.status,
        updated.current_node,
        updated.metadata === undefined ? null : JSON.stringify(updated.metadata),
        updated.updated_at,
      ],
    )
    return updated
  })
}

// ---------------------------------------------------------------------------
// tasks

export async function listWaypointTasksPg(projectRoot: string): Promise<WaypointFolderTask[]> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const result = await pool.query(`SELECT * FROM ${quoteIdent(schema)}.tasks ORDER BY id`, [])
  return result.rows.map(taskFromRow)
}

export async function insertWaypointTasksPg(projectRoot: string, tasks: readonly WaypointFolderTask[]): Promise<void> {
  if (tasks.length === 0) return
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  await withTransaction(pool, async (client) => {
    for (const task of tasks) {
      await client.query(
        `INSERT INTO ${quoteIdent(schema)}.tasks (id, route_id, plan_ref, title, phase, wave, kind, status, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          task.id,
          task.route_id,
          task.plan_ref,
          task.title,
          task.phase,
          task.wave,
          task.kind,
          task.status,
          task.metadata === undefined ? null : JSON.stringify(task.metadata),
          task.created_at,
          task.updated_at,
        ],
      )
    }
  })
}

export async function updateWaypointTaskPg(
  projectRoot: string,
  taskId: string,
  patch: Partial<Pick<WaypointFolderTask, 'status' | 'updated_at' | 'metadata'>>,
): Promise<WaypointFolderTask> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)

  return withTransaction(pool, async (client) => {
    const result = await client.query(`SELECT * FROM ${quoteIdent(schema)}.tasks WHERE id = $1 FOR UPDATE`, [taskId])
    if (result.rows.length === 0) throw new Error(`Task not found: ${taskId}`)
    const updated: WaypointFolderTask = { ...taskFromRow(result.rows[0]), ...patch }
    await client.query(
      `UPDATE ${quoteIdent(schema)}.tasks SET status = $2, metadata = $3::jsonb, updated_at = $4 WHERE id = $1`,
      [
        taskId,
        updated.status,
        updated.metadata === undefined ? null : JSON.stringify(updated.metadata),
        updated.updated_at,
      ],
    )
    return updated
  })
}

// ---------------------------------------------------------------------------
// events

export async function appendRouteEventPg(
  projectRoot: string,
  routeId: string,
  input: AppendRouteEventInput,
): Promise<WaypointFolderRouteEvent> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)

  return withTransaction(pool, async (client) => {
    // Serialize store-side appends per route: the id below is count-derived,
    // and two concurrent transactions reading the same count insert the same
    // id and trip UNIQUE(route_id, id) — observed under the W4 bridge pool
    // (concurrency ≥ 2 recording two off-graph outcomes for one route).
    // Engine-written events are immune (compile-time `event-eNNN` ids, X1)
    // and never take this lock.
    await client.query(`SELECT 1 FROM ${quoteIdent(schema)}.routes WHERE id = $1 FOR UPDATE`, [routeId])
    const count = await client.query(
      `SELECT count(*)::int AS total FROM ${quoteIdent(schema)}.route_events WHERE route_id = $1`,
      [routeId],
    )
    const event: WaypointFolderRouteEvent = {
      id: nextEventId(count.rows[0].total as number),
      route_id: routeId,
      kind: input.kind,
      created_at: timestampFor(input.now),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    }
    await client.query(
      `INSERT INTO ${quoteIdent(schema)}.route_events (id, route_id, kind, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        event.id,
        event.route_id,
        event.kind,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        event.created_at,
      ],
    )
    return event
  })
}

export async function readRouteEventsPg(
  projectRoot: string,
  routeId: string,
  options: ReadRouteEventsOptions = {},
): Promise<RouteEventPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Route event limit must be a positive integer: ${limit}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Route event offset must be a non-negative integer: ${offset}`)
  }

  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const [page, total] = await Promise.all([
    pool.query(
      `SELECT * FROM ${quoteIdent(schema)}.route_events WHERE route_id = $1 ORDER BY ord LIMIT $2 OFFSET $3`,
      [routeId, limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS total FROM ${quoteIdent(schema)}.route_events WHERE route_id = $1`, [routeId]),
  ])

  return {
    items: page.rows.map(eventFromRow),
    total: total.rows[0].total as number,
    limit,
    offset,
  }
}

// ---------------------------------------------------------------------------
// row mapping + shared helpers

function routeFromRow(row: Record<string, unknown>): WaypointFolderRoute {
  return {
    id: row.id as string,
    quest: row.quest as string,
    status: row.status as WaypointFolderRoute['status'],
    current_node: (row.current_node as string | null) ?? null,
    subject: row.subject as WaypointFolderRoute['subject'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    ...(row.metadata === null || row.metadata === undefined ? {} : { metadata: row.metadata as Record<string, unknown> }),
  }
}

function taskFromRow(row: Record<string, unknown>): WaypointFolderTask {
  const metadata = taskMetadataWithEvidence(
    row.metadata === null || row.metadata === undefined ? undefined : (row.metadata as Record<string, unknown>),
    row.evidence,
  )
  return {
    id: row.id as string,
    route_id: row.route_id as string,
    plan_ref: row.plan_ref as string,
    title: row.title as string,
    phase: row.phase as string,
    wave: (row.wave as number | null) ?? null,
    kind: row.kind as WaypointFolderTask['kind'],
    status: row.status as WaypointFolderTask['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    ...(metadata === undefined ? {} : { metadata }),
  }
}

/**
 * Surface the durable engine's `evidence` column (B2) on the task read model
 * as `metadata.runner.evidence` — so `waypoint tasks --json` shows engine-written
 * evidence without changing the WaypointFolderTask shape. Metadata that already
 * carries `runner.evidence` wins; the column never clobbers it.
 */
function taskMetadataWithEvidence(
  metadata: Record<string, unknown> | undefined,
  evidence: unknown,
): Record<string, unknown> | undefined {
  if (evidence === null || evidence === undefined) return metadata
  const runner = isRecord(metadata?.runner) ? metadata.runner : undefined
  if (runner !== undefined && runner.evidence !== undefined) return metadata
  return { ...(metadata ?? {}), runner: { ...(runner ?? {}), evidence } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventFromRow(row: Record<string, unknown>): WaypointFolderRouteEvent {
  return {
    id: row.id as string,
    route_id: row.route_id as string,
    kind: row.kind as string,
    created_at: row.created_at as string,
    ...(row.payload === null || row.payload === undefined ? {} : { payload: row.payload }),
  }
}

async function selectRoutes(queryable: Queryable, schema: string): Promise<WaypointFolderRoute[]> {
  const result = await queryable.query(`SELECT * FROM ${quoteIdent(schema)}.routes ORDER BY id`, [])
  return result.rows.map(routeFromRow)
}

function nextRouteId(routes: readonly WaypointFolderRoute[]): string {
  const nextNumber = routes.reduce((max, route) => {
    const match = /^route-(\d+)$/.exec(route.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `route-${String(nextNumber).padStart(3, '0')}`
}

function nextEventId(existingCount: number): string {
  return `event-${String(existingCount + 1).padStart(3, '0')}`
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export async function withTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // rollback failure is secondary; surface the original error
    }
    throw error
  } finally {
    client.release()
  }
}
