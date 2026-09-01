import { quoteIdent } from '../postgres/client.ts'
import { appendRouteEventPg, readRouteEventsPg } from '../postgres/store.ts'

import type pg from 'pg'
import type { AppendRouteEventInput, ReadRouteEventsOptions, RouteEventPage, WaypointFolderRouteEvent } from './types.ts'

// Backend note: the route-event seam, backed by the project's postgres
// schema. The folder (JSONL) backend was retired in P5
// (docs/designs/p5-folder-retirement.md); legacy folder projects move over
// with `waypoint migrate`.

export async function appendRouteEvent(
  projectRoot: string,
  routeId: string,
  input: AppendRouteEventInput,
): Promise<WaypointFolderRouteEvent> {
  return appendRouteEventPg(projectRoot, routeId, input)
}

export async function readRouteEvents(
  projectRoot: string,
  routeId: string,
  options: ReadRouteEventsOptions = {},
): Promise<RouteEventPage> {
  return readRouteEventsPg(projectRoot, routeId, options)
}

/**
 * Append through an existing PostgreSQL transaction. Safety authorities use
 * this seam when their own durable row and the route event must commit once.
 */
export async function appendRouteEventInTransaction(
  client: pg.PoolClient,
  schema: string,
  routeId: string,
  input: AppendRouteEventInput & { readonly dedupeKey?: string },
): Promise<WaypointFolderRouteEvent> {
  const route = await client.query(
    `SELECT 1 FROM ${quoteIdent(schema)}.routes WHERE id = $1 FOR UPDATE`,
    [routeId],
  )
  if (route.rows.length === 0) throw new Error(`Route not found: ${routeId}`)

  if (input.dedupeKey !== undefined) {
    const existing = await client.query(
      `SELECT * FROM ${quoteIdent(schema)}.route_events
       WHERE route_id = $1 AND dedupe_key = $2 ORDER BY ord LIMIT 1`,
      [routeId, input.dedupeKey],
    )
    if (existing.rows.length > 0) return routeEventFromRow(existing.rows[0] as Record<string, unknown>)
  }

  const count = await client.query(
    `SELECT count(*)::int AS total FROM ${quoteIdent(schema)}.route_events WHERE route_id = $1`,
    [routeId],
  )
  const event: WaypointFolderRouteEvent = {
    id: `event-${String(Number(count.rows[0]?.total ?? 0) + 1).padStart(3, '0')}`,
    route_id: routeId,
    kind: input.kind,
    created_at: (input.now ?? new Date()).toISOString(),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  }
  await client.query(
    `INSERT INTO ${quoteIdent(schema)}.route_events
       (id, route_id, kind, payload, created_at, dedupe_key)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      event.id,
      event.route_id,
      event.kind,
      event.payload === undefined ? null : JSON.stringify(event.payload),
      event.created_at,
      input.dedupeKey ?? null,
    ],
  )
  return event
}

function routeEventFromRow(row: Record<string, unknown>): WaypointFolderRouteEvent {
  return {
    id: row.id as string,
    route_id: row.route_id as string,
    kind: row.kind as string,
    created_at: row.created_at as string,
    ...(row.payload === null || row.payload === undefined ? {} : { payload: row.payload }),
  }
}
