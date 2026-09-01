import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { initWaypointProject } from '../project/init.ts'
import { PostgresTestProjects } from '../testing/postgres.ts'
import { runWaypointBridge } from './bridge.ts'

/**
 * "Active" is not "advancing" (route-005, 2026-08-29): a rejected dispatch
 * attempt sets the bridge's poolError, after which every drain() returns at
 * its guard without claiming. In --once mode settle() rethrows and the run
 * fails visibly. In daemon mode the loop used to keep spinning silently —
 * alive, listening, sweeping, claiming nothing — while pending work sat for
 * 89 minutes under a bridge that looked healthy from every angle.
 *
 * The fix: daemon mode exits LOUDLY on a poisoned pool. Work is durable,
 * claims lease-reclaim, and the Console's bridge manager starts a fresh
 * bridge; a restart is honest where a silent zombie is not.
 */
const projects = new PostgresTestProjects()

beforeAll(() => projects.setEnv())
afterAll(() => projects.cleanup())

describe('a poisoned pool ends the daemon loudly instead of zombifying it', () => {
  it('exits with the attempt error named, rather than spinning forever', async () => {
    const root = await projects.mkProjectRoot('bridge-daemon-liveness-')
    await initWaypointProject(root, { quest: 'example', postgres: { durable: true } })
    const { pool, schema } = await getWaypointPostgres(root)
    const s = quoteIdent(schema)
    await pool.query(
      `INSERT INTO ${s}.routes (id, quest, status, subject, created_at, updated_at)
       VALUES ('route-800', 'example', 'active', '{}'::jsonb, now(), now())`,
    )
    await pool.query(
      `INSERT INTO ${s}.dispatches (route_id, task_ref, recipe, instance_id, status)
       VALUES ('route-800', 'poisoned-step', 'example-recipe', 'instance-1', 'pending')`,
    )
    // Break ONLY the attempt's outcome bookkeeping: the outcome UPDATE is the
    // one statement that touches `sandbox`, so the claim, the drain queries
    // and the sweeps all stay healthy — the exact shape of a pg failure mid-
    // attempt. Before the fix this test HANGS (the daemon spins, claiming
    // nothing); the timeout is the regression signal.
    await pool.query(`ALTER TABLE ${s}.dispatches RENAME COLUMN sandbox TO sandbox_hidden`)

    const said: string[] = []
    await expect(
      runWaypointBridge(root, {
        runtime: { runRecipe: async () => ({ status: 'finished' }) },
        pollIntervalMs: 25,
        onEvent: (line) => said.push(line),
      }),
    ).rejects.toThrow(/sandbox/)

    expect(said.join('\n')).toMatch(/crashed the pool — exiting so a fresh bridge takes over/)
    // The work survives the crash for the next bridge: the row is still there,
    // claimed by the dead attempt, and the claim lease will reclaim it.
    const { rows } = await pool.query(`SELECT status FROM ${s}.dispatches WHERE task_ref = 'poisoned-step'`)
    expect(rows[0]?.status).toBe('running')
  }, 20_000)
})
