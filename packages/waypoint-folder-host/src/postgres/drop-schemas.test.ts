import { describe, expect, it } from 'vitest'

import { deriveProjectSchemaName } from '../project/backend.ts'
import { dropProjectSchemas } from './client.ts'

/**
 * rsc-g5v — the teardown that keeps a red gated run from leaking scratch
 * schemas. The danger the old single `for` loop had: one schema that cannot be
 * dropped (a superuser-owned schema the waypoint role can't touch, a stuck
 * instance, a bad URL) aborted the loop and stranded every schema after it.
 * These pin that one failure never strands the rest, using a fake pool so the
 * policy is proven without a live Postgres.
 */
describe('dropProjectSchemas (rsc-g5v red-run resilience)', () => {
  /** A pool that succeeds on every query, except DROP SCHEMA of `poison`. */
  function fakePool(poison?: string) {
    const dropped: string[] = []
    const pool = {
      async query(text: string) {
        if (text.startsWith('DROP SCHEMA')) {
          if (poison !== undefined && text.includes(poison)) {
            throw new Error(`permission denied to drop schema ${poison}`)
          }
          dropped.push(text)
        }
        // cancelSchemaDurableInstances' `SELECT DISTINCT instance_id` — no
        // instances, so it cancels nothing and returns.
        return { rows: [] as { instance_id: string }[] }
      },
    }
    return { pool, dropped }
  }

  it('drops every OTHER schema when one is un-droppable, and reports the failure', async () => {
    const roots = ['/tmp/proj-a', '/tmp/proj-poison', '/tmp/proj-b']
    const [schemaA, schemaPoison, schemaB] = roots.map(deriveProjectSchemaName)
    const { pool, dropped } = fakePool(schemaPoison)

    const result = await dropProjectSchemas(pool, roots)

    expect(result.dropped).toEqual([schemaA, schemaB])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.schema).toBe(schemaPoison)
    expect(result.failed[0]!.error).toContain('permission denied')
    // The loop reached schemaB — it did not abort at the poison in the middle.
    expect(dropped.some((d) => d.includes(schemaB))).toBe(true)
  })

  it('dedupes roots that resolve to the same schema (drops it once)', async () => {
    const { pool } = fakePool()
    const result = await dropProjectSchemas(pool, ['/tmp/same', '/tmp/same'])
    expect(result.dropped).toEqual([deriveProjectSchemaName('/tmp/same')])
    expect(result.failed).toEqual([])
  })

  it('returns empty results for no roots', async () => {
    const { pool } = fakePool()
    expect(await dropProjectSchemas(pool, [])).toEqual({ dropped: [], failed: [] })
  })
})
