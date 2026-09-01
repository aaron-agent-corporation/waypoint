import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { initWaypointProject } from '../project/init.ts'
import { PostgresTestProjects } from '../testing/postgres.ts'
import { closeCancelledRouteDispatches } from './bridge.ts'

/**
 * Cancelling a route stopped the route, not its queue. Two cancelled contact
 * intakes were claimed and run anyway while the conversion queued behind them
 * waited fifteen minutes (2026-08-19).
 */
const projects = new PostgresTestProjects()

beforeAll(() => projects.setEnv())
afterAll(() => projects.cleanup())

async function caseWithRoutes(): Promise<{ pool: Awaited<ReturnType<typeof getWaypointPostgres>>['pool']; schema: string }> {
  const root = await projects.mkProjectRoot('bridge-cancelled-')
  await initWaypointProject(root, { quest: 'example', postgres: { durable: true } })
  const { pool, schema } = await getWaypointPostgres(root)
  const s = quoteIdent(schema)
  const now = new Date().toISOString()
  for (const [id, status] of [['route-900', 'cancelled'], ['route-901', 'active']] as const) {
    await pool.query(
      `INSERT INTO ${s}.routes (id, quest, status, subject, created_at, updated_at)
       VALUES ($1, 'example', $2, '{}'::jsonb, $3, $3)`,
      [id, status, now],
    )
    await pool.query(
      `INSERT INTO ${s}.dispatches (route_id, task_ref, recipe, instance_id, status, created_at)
       VALUES ($1, 'some-task', 'some-recipe', 'instance-1', 'pending', now())`,
      [id],
    )
  }
  return { pool, schema }
}

describe('a cancelled route does not keep dispatching work', () => {
  it('closes the queued dispatch and says which route it belonged to', async () => {
    const { pool, schema } = await caseWithRoutes()
    const s = quoteIdent(schema)

    const closed = await closeCancelledRouteDispatches(pool, schema)

    expect(closed.map((row) => row.route_id)).toEqual(['route-900'])
    const rows = await pool.query(
      `SELECT route_id, status, close_reason FROM ${s}.dispatches ORDER BY route_id`,
    )
    expect(rows.rows).toEqual([
      {
        route_id: 'route-900',
        status: 'failed',
        close_reason: 'route route-900 was cancelled before this dispatch ran',
      },
      // The live route's work is untouched — this closes the cancelled, never the queue.
      { route_id: 'route-901', status: 'pending', close_reason: null },
    ])
  })
})
