import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { initWaypointProject } from '../project/init.ts'
import { PostgresTestProjects } from '../testing/postgres.ts'
import { dispatchesHandledElsewhere, runWaypointBridge } from './bridge.ts'

/**
 * A bridge's closing tally must account for the SCHEMA, not just for itself.
 *
 * Found 2026-08-23 on the first full `medical-knowledge-layer-tools` run: the
 * bridge logged eleven dispatches and the run had twelve. The twelfth
 * (`visit-table`) had been claimed by a second bridge the Console's supervisor
 * registered when the route started — atomic claim, correct execution, both
 * logs individually accurate. But the operator reads ONE log, and there a
 * dispatch handled next door is indistinguishable from a step that never ran.
 */
const projects = new PostgresTestProjects()

beforeAll(() => projects.setEnv())
afterAll(() => projects.cleanup())

const SIBLING = 'OtherHost.local:99999:abcdef'

/** A schema holding one dispatch, claimed by `claimedBy` (null = unclaimed). */
async function schemaWithDispatch(
  claimedBy: string | null,
): Promise<{ root: string; pool: Awaited<ReturnType<typeof getWaypointPostgres>>['pool']; schema: string; before: Date }> {
  const root = await projects.mkProjectRoot('bridge-sibling-')
  await initWaypointProject(root, { quest: 'example', postgres: { durable: true } })
  const { pool, schema } = await getWaypointPostgres(root)
  const s = quoteIdent(schema)
  // The comparison instant, read from the DATABASE clock — the bridge and the
  // rows are timestamped by postgres, and a process clock a few ms off would
  // make this test flap rather than fail.
  const { rows: clock } = await pool.query<{ now: Date }>('SELECT now() AS now')
  const before = clock[0]!.now
  await pool.query(
    `INSERT INTO ${s}.routes (id, quest, status, subject, created_at, updated_at)
     VALUES ('route-700', 'example', 'active', '{}'::jsonb, now(), now())`,
  )
  await pool.query(
    `INSERT INTO ${s}.dispatches
       (route_id, task_ref, recipe, instance_id, status, created_at, claimed_at, claimed_by)
     VALUES ('route-700', 'visit-table', 'medical-layer-visit-table', 'instance-1',
             'completed', now(), ${claimedBy === null ? 'NULL' : 'now()'}, $1)`,
    [claimedBy],
  )
  return { root, pool, schema, before }
}

describe('a bridge accounts for work another bridge did on its schema', () => {
  it('names the dispatch, its recipe, and which bridge took it', async () => {
    const { pool, schema, before } = await schemaWithDispatch(SIBLING)

    const elsewhere = await dispatchesHandledElsewhere(pool, schema, 'this-bridge', before, () => {})

    expect(elsewhere).toEqual([
      {
        dispatch_id: expect.any(Number),
        route_id: 'route-700',
        task_ref: 'visit-table',
        recipe: 'medical-layer-visit-table',
        status: 'completed',
        claimed_by: SIBLING,
      },
    ])
  })

  it('does not report this bridge\'s own work as a sibling\'s', async () => {
    const { pool, schema, before } = await schemaWithDispatch(SIBLING)

    // Same bridge id as the claimer: its work is already in `processed`, and
    // listing it again would double-count the run rather than complete it.
    expect(await dispatchesHandledElsewhere(pool, schema, SIBLING, before, () => {})).toEqual([])
  })

  it('ignores work claimed before this bridge came up', async () => {
    const { pool, schema } = await schemaWithDispatch(SIBLING)

    // Anchored AFTER the claim: a bridge accounts for its own lifetime, not for
    // the schema's whole history, or every run on an old case would recite it.
    const { rows } = await pool.query<{ now: Date }>('SELECT now() AS now')
    expect(await dispatchesHandledElsewhere(pool, schema, 'this-bridge', rows[0]!.now, () => {})).toEqual([])
  })

  it('treats an unclaimed row as nobody\'s, not as a phantom sibling', async () => {
    const { pool, schema, before } = await schemaWithDispatch(null)

    expect(await dispatchesHandledElsewhere(pool, schema, 'this-bridge', before, () => {})).toEqual([])
  })

  it('says so instead of returning a quiet empty list when the table cannot be read', async () => {
    const { pool, before } = await schemaWithDispatch(SIBLING)
    const said: string[] = []

    // The check runs after the work is done, so it must not fail the run — but
    // a silent catch would rebuild the exact blind spot this closes.
    const elsewhere = await dispatchesHandledElsewhere(pool, 'no_such_schema', 'this-bridge', before, (e) =>
      said.push(e),
    )

    expect(elsewhere).toEqual([])
    expect(said.join('\n')).toContain('covers only')
  })

  it('reports an empty list, never an absent field, on an ordinary lone run', async () => {
    const { root } = await schemaWithDispatch(null)

    const result = await runWaypointBridge(root, { once: true })

    expect(result.elsewhere).toEqual([])
  })
})
