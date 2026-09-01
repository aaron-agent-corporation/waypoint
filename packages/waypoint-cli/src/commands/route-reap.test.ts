import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findAbandonedRoutes,
  getWaypointRuntimeRoute,
  initWaypointProject,
  installQuestCatalog,
  loadBundledWaypointCatalog,
  startQuestRoute,
} from '@waypoint/folder-host'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'
import { requireTestPgDurableUrl } from '../../../waypoint-folder-host/src/testing/postgres.ts'

// Phase 0, item 10: `WAYPOINT_PGDURABLE_TEST_URL` dates from the spike, when a
// durable Postgres was a separate container. Since P5 the Console-managed
// instance carries pg_durable and is durable by default, so gating on that
// variable skipped this suite on every ordinary checkout while the run
// reported green. requireTestPgDurableUrl() defaults to that instance.
const TEST_URL = requireTestPgDurableUrl()
const pgProjects = new PostgresTestProjects()

/**
 * rsc-jtm — `waypoint route reap` end to end against a real pg_durable engine.
 * The pure policy is covered in reap.test.ts; this proves the DB wiring: a real
 * durable route that no bridge ever advanced is found, classified abandoned
 * once stale, and actually cancelled at the engine — not just in the route row.
 */
describe('waypoint route reap (rsc-jtm, real pg_durable)', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(() => pgProjects.cleanup())

  async function startAbandonableRoute(): Promise<{ cwd: string; schema: string }> {
    const cwd = await pgProjects.mkProjectRoot('route-reap-')
    const project = await initWaypointProject(cwd, {
      quest: 'runner',
      postgres: { url: TEST_URL, durable: true },
      // A worker command that never runs — no bridge drains, so the route parks.
      runtime: { recipe: 'worker', worker: { command: 'true' } },
    })
    await installQuestCatalog(cwd, await loadBundledWaypointCatalog(), { quest: 'runner' })
    await startQuestRoute(cwd, { quest: 'runner' })
    return { cwd, schema: project.config.backend.postgres!.schema! }
  }

  async function backdateRoute(schema: string, hours: number): Promise<void> {
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
    try {
      await pool.query(`UPDATE "${schema}".routes SET updated_at = $1 WHERE id = 'route-001'`, [
        new Date(Date.now() - hours * 3_600_000).toISOString(),
      ])
    } finally {
      await pool.end()
    }
  }

  async function engineStatus(schema: string): Promise<string | null> {
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
    try {
      const iid = (await pool.query(`SELECT instance_id FROM "${schema}".routes WHERE id = 'route-001'`)).rows[0] as {
        instance_id: string | null
      }
      if (!iid?.instance_id) return null
      return ((await pool.query('SELECT df.status($1) AS s', [iid.instance_id])).rows[0] as { s: string }).s
    } finally {
      await pool.end()
    }
  }

  it('a freshly-started route is NOT reapable; the same route stale IS', async () => {
    const { cwd, schema } = await startAbandonableRoute()
    expect((await findAbandonedRoutes(cwd)).some((c) => c.reapable), 'a route seconds old must never be reapable').toBe(false)
    await backdateRoute(schema, 100)
    const aged = await findAbandonedRoutes(cwd)
    expect(aged.filter((c) => c.reapable)).toHaveLength(1)
    expect(aged.find((c) => c.reapable)!.classification).toContain('abandoned')
  })

  it('dry-run reap reports the candidate but cancels nothing; --cancel stops it at the engine', async () => {
    const { cwd, schema } = await startAbandonableRoute()
    await backdateRoute(schema, 100)

    // Dry run: lists REAP, changes nothing.
    const { io, stdout } = makeIo(cwd)
    expect(await runWaypointCli(['route', 'reap'], io)).toBe(0)
    expect(stdout.join('\n')).toMatch(/REAP\s+route-001/)
    expect(stdout.join('\n')).toContain('--cancel to stop them')
    expect((await getWaypointRuntimeRoute(cwd, 'route-001'))!.status, 'dry-run must not cancel').not.toBe('cancelled')
    expect(await engineStatus(schema)).not.toBe('cancelled')

    // --cancel: the engine instance actually goes to cancelled, not just the row.
    expect(await runWaypointCli(['route', 'reap', '--cancel'], silentIo(cwd))).toBe(0)
    expect((await getWaypointRuntimeRoute(cwd, 'route-001'))!.status).toBe('cancelled')
    expect(await engineStatus(schema), 'the pg_durable instance must be cancelled, or it keeps bloating the store').toBe(
      'cancelled',
    )
  })

  it('--stale-hours raises the bar: a 100h route is kept under a 200h threshold', async () => {
    const { cwd, schema } = await startAbandonableRoute()
    await backdateRoute(schema, 100)
    const { io, stdout } = makeIo(cwd)
    expect(await runWaypointCli(['route', 'reap', '--stale-hours', '200', '--cancel'], io)).toBe(0)
    expect(stdout.join('\n')).toContain('No abandoned routes to reap')
    expect((await getWaypointRuntimeRoute(cwd, 'route-001'))!.status).not.toBe('cancelled')
  })
})
