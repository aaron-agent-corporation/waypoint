import { writeFile } from 'node:fs/promises'

import { stringify as yamlStringify } from 'yaml'

import { appendRouteEvent } from '../events/jsonl.ts'
import { DEFAULT_POSTGRES_URL, deriveProjectSchemaName } from '../project/backend.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointPostgresFor, quoteIdent } from './client.ts'
import {
  readLegacyFolderConfig,
  readLegacyFolderRouteEvents,
  readLegacyFolderRoutes,
  readLegacyFolderTasks,
} from './legacy-folder.ts'
import { withTransaction } from './store.ts'

import type { WaypointFolderRouteEvent } from '../events/types.ts'

/**
 * The M6 migration tool (P5/F2, docs/designs/p5-folder-retirement.md): move a
 * legacy folder project's route/task/event state into its per-project
 * postgres schema and flip `.waypoint/config.yaml` to the postgres backend.
 *
 * Contract:
 * - Rows are copied VERBATIM — ids, timestamps, statuses, metadata — so the
 *   read models are byte-identical across the flip (the conformance
 *   property). Route metadata that records `backend.route: folder` from
 *   start time stays as written: it is history, not configuration.
 * - Migrated projects land on PLAIN postgres (durable stays off): an
 *   in-flight folder route has no engine instance, and gate decisions on a
 *   durable-config project require one. Enable durable later for new quests.
 * - The copy runs in one transaction and the config flips only after commit,
 *   so a crash mid-migration leaves a folder project untouched (re-run
 *   safe). A target schema that already holds routes is refused.
 * - The `.waypoint/routes|tasks|events` files stay on disk as an audit trail,
 *   read through the frozen legacy readers (the strict config parser fails
 *   closed on retired backend values by design — this tool is the on-ramp).
 */
export interface MigrateFolderProjectResult {
  readonly url: string
  readonly schema: string
  readonly routes: number
  readonly tasks: number
  readonly events: number
}

export async function migrateFolderProjectToPostgres(
  projectRoot: string,
  options: { readonly now?: Date } = {},
): Promise<MigrateFolderProjectResult> {
  const paths = getWaypointProjectPaths(projectRoot)
  const legacy = await readLegacyFolderConfig(projectRoot)
  if (legacy === null) {
    throw new Error('Project already runs the postgres backend — nothing to migrate.')
  }

  // 1. Read the legacy folder state (frozen readers — the store layer no
  //    longer speaks YAML).
  const routes = await readLegacyFolderRoutes(projectRoot)
  const tasks = await readLegacyFolderTasks(projectRoot)
  const eventsByRoute = new Map<string, readonly WaypointFolderRouteEvent[]>()
  for (const route of routes) {
    eventsByRoute.set(route.id, await readLegacyFolderRouteEvents(projectRoot, route.id))
  }

  // 2. Resolve the target connection explicitly — same precedence the store
  //    layer applies after the flip (env > config > managed default; schema
  //    per project).
  const schema = legacy.postgres.schema ?? deriveProjectSchemaName(paths.projectRoot)
  const url = process.env.WAYPOINT_POSTGRES_URL?.trim() || legacy.postgres.url || DEFAULT_POSTGRES_URL
  const { pool, schema: resolvedSchema } = await getWaypointPostgresFor({ url, schema, durable: false })
  const s = quoteIdent(resolvedSchema)

  // 3. Refuse a schema that already holds run state.
  const existing = await pool.query(`SELECT count(*)::int AS total FROM ${s}.routes`)
  if ((existing.rows[0] as { total: number }).total > 0) {
    throw new Error(
      `Postgres schema ${resolvedSchema} already holds routes — refusing to migrate into it. Point the project at an empty schema or clear it first.`,
    )
  }

  // 4. Copy everything verbatim in one transaction.
  await withTransaction(pool, async (client) => {
    for (const route of routes) {
      await client.query(
        `INSERT INTO ${s}.routes (id, quest, status, current_node, subject, metadata, created_at, updated_at)
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
    }
    for (const task of tasks) {
      await client.query(
        `INSERT INTO ${s}.tasks (id, route_id, plan_ref, title, phase, wave, kind, status, metadata, created_at, updated_at)
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
    for (const [routeId, events] of eventsByRoute) {
      for (const event of events) {
        await client.query(
          `INSERT INTO ${s}.route_events (id, route_id, kind, payload, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [event.id, routeId, event.kind, event.payload === undefined ? null : JSON.stringify(event.payload), event.created_at],
        )
      }
    }
  })

  // 5. Flip the backend — only after the copy committed. The raw document is
  //    preserved verbatim (runtime, roots, unknown keys) except the flip.
  const flipped = {
    ...legacy.raw,
    backend: { route: 'postgres', postgres: { ...legacy.postgres, schema } },
    updated_at: (options.now ?? new Date()).toISOString(),
  }
  await writeFile(paths.configPath, yamlStringify(flipped), 'utf8')

  // 6. Record the migration on each route — evidence in the event log, not
  //    agent say-so (the appended event lands on postgres, proving the flip).
  let eventTotal = 0
  for (const route of routes) {
    const events = eventsByRoute.get(route.id) ?? []
    eventTotal += events.length
    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.migrated',
      payload: {
        from: legacy.route,
        to: 'postgres',
        schema: resolvedSchema,
        tasks: tasks.filter((task) => task.route_id === route.id).length,
        events: events.length,
      },
      now: options.now,
    })
  }

  return { url, schema: resolvedSchema, routes: routes.length, tasks: tasks.length, events: eventTotal }
}
