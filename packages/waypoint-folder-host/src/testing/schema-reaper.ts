import { afterAll, beforeAll } from 'vitest'

import pg from 'pg'

import {
  cancelSchemaDurableInstances,
  quoteIdent,
  takeCreatedTestSchemas,
} from '../postgres/client.ts'
import { requireTestPostgresUrl } from './postgres.ts'

/**
 * A vitest `setupFiles` entry: drop every per-project schema a test file
 * creates, as soon as that file finishes.
 *
 * A schema is created per project, and any suite that builds a temp project
 * root with `mkdtemp` gets a fresh one. Nothing dropped them, so by 2026-08-22
 * the local Postgres held **6,664 `waypoint_*` schemas and 525,817 relations**
 * against three real projects. One suite alone
 * (one large suite) accounted for 5,181 of them. The leak was
 * invisible because nothing ever looked at the catalog and each run's own
 * contribution was tiny.
 *
 * This does NOT fix the suite's `out of shared memory` failures, which are
 * lock-table sizing and were unchanged by dropping all 6,660 (see
 * docs/ERRORS-AND-FIXES.md). It stops the leak, which is worth doing on its
 * own terms.
 *
 * `PostgresTestProjects` already cleans up properly and remains the right
 * thing for a suite to use. But it is opt-in, and 51 of the 135 suites that
 * call `mkdtemp` do not use it. This is the backstop underneath it, so
 * correctness stops depending on the next author remembering.
 *
 * Why `setupFiles` and not `globalSetup`: globalSetup is loaded through Vite's
 * SSR pipeline from the config root, where pnpm's strict layout puts `pg` out
 * of reach — it cannot even import its own client. setupFiles runs inside the
 * worker, where the same imports every test uses resolve normally. It is also
 * the better shape: schemas go as each file ends rather than accumulating for
 * the length of the run.
 *
 * Scope is deliberately narrow. It drops ONLY names this process recorded in
 * `ensureSchemaDdl`, and recording is gated on `WAYPOINT_TEST_SCHEMAS`, set just
 * below. It never enumerates the catalog, so a real case's schema cannot be
 * caught by it even by mistake.
 */

beforeAll(() => {
  process.env.WAYPOINT_TEST_SCHEMAS = '1'
})

afterAll(async () => {
  const schemas = takeCreatedTestSchemas()
  if (schemas.length === 0) return

  const pool = new pg.Pool({ connectionString: requireTestPostgresUrl(), allowExitOnIdle: true })
  const failures: string[] = []
  try {
    for (const schema of schemas) {
      // Cancel before dropping: a bare DROP leaves the schema's pg_durable
      // instance parked 'running' against a schema that no longer exists,
      // burning engine worker cycles forever (rsc-0f3). 178 such orphans had
      // built up by the 2026-08-22 cleanup.
      await cancelSchemaDurableInstances(pool, schema).catch(() => undefined)
      try {
        // One statement, one transaction. Dropping many under a single
        // transaction exhausts the lock table — the same "out of shared
        // memory" this reaper exists to prevent.
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`)
      } catch (error) {
        failures.push(`${schema}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    await pool.end().catch(() => undefined)
  }

  // Report, never throw: a drop failure must not turn a green suite red, and
  // a silent reaper is how the catalog filled up in the first place.
  if (failures.length > 0) {
    process.stderr.write(`schema reaper: ${failures.length} of ${schemas.length} not dropped\n`)
    for (const failure of failures.slice(0, 5)) process.stderr.write(`  ${failure}\n`)
  }
})
