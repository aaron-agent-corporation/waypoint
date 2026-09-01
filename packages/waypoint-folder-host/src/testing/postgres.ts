import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'

import { dropProjectSchemas } from '../postgres/client.ts'

/**
 * Test harness for the postgres-backed run-state stores (P5,
 * docs/designs/p5-folder-retirement.md). Since the folder backend retired,
 * every suite that touches route/task/event state REQUIRES a live Postgres —
 * this fails LOUD (not skip) so a green run can never silently shrink.
 */
/**
 * The Console-managed local Postgres: port 5433, non-superuser `waypoint` role
 * (deploy/postgres/install.sh). pg_durable refuses to start instances for a
 * superuser unless explicitly enabled, so connecting as the login user fails
 * where `waypoint` succeeds — worth defaulting to, since guessing this wrong
 * makes the whole suite look environmentally broken when it is not.
 */
export const CONSOLE_POSTGRES_TEST_URL = 'postgres://waypoint@127.0.0.1:5433/postgres'

export function requireTestPostgresUrl(): string {
  const url = process.env.WAYPOINT_POSTGRES_TEST_URL?.trim()
  if (url) return url
  // A standard install has one, so default to it rather than failing every
  // suite by default and making a normal checkout look broken. An install
  // without it still fails loud at connect time — a green run can never
  // silently shrink, which is what this guard exists for.
  return CONSOLE_POSTGRES_TEST_URL
}

/**
 * The same instance, for suites that need the pg_durable extension.
 *
 * `WAYPOINT_PGDURABLE_TEST_URL` dates from the spike, when a durable Postgres was
 * a separate container you had to stand up. Since P5 it is not: the
 * Console-managed instance carries pg_durable (0.2.4) and is durable by
 * default, so gating on that variable skipped the durable suites on every
 * ordinary checkout — including the only coverage of gate approve/reject,
 * claim leases, and the X1–X6 operator matrix — while the run reported green
 * (Phase 0, item 10).
 *
 * Kept as a separate function rather than folded into
 * `requireTestPostgresUrl()` because the REQUIREMENT is genuinely different: a
 * plain Postgres satisfies one and not the other. An instance without the
 * extension now fails loud where these suites use it, which is the correct
 * outcome — a missing extension is a broken environment, not a reason to
 * report success over an empty set.
 */
export function requireTestPgDurableUrl(): string {
  const url = process.env.WAYPOINT_PGDURABLE_TEST_URL?.trim()
  if (url) return url
  return CONSOLE_POSTGRES_TEST_URL
}

/**
 * Tracks temp project roots and drops their derived per-project schemas on
 * cleanup. Usage: `setEnv()` in beforeAll (points resolution at the test
 * instance), `mkProjectRoot()` per project, `cleanup()` in afterAll.
 */
export class PostgresTestProjects {
  private readonly url = requireTestPostgresUrl()
  private readonly roots: string[] = []
  private savedUrl: string | undefined
  private savedSchema: string | undefined
  private savedConfigHome: string | undefined
  private hadConfigHome = false
  /** The sandboxed WAYPOINT_CONFIG_HOME set by setEnv() (A1: keeps the
   * bridge registry a durable start writes out of the operator's real
   * `~/.waypoint`). Suites asserting registry writes read from here. */
  configHome: string | undefined

  setEnv(): void {
    this.savedUrl = process.env.WAYPOINT_POSTGRES_URL
    this.savedSchema = process.env.WAYPOINT_POSTGRES_SCHEMA
    process.env.WAYPOINT_POSTGRES_URL = this.url
    delete process.env.WAYPOINT_POSTGRES_SCHEMA
    this.hadConfigHome = true
    this.savedConfigHome = process.env.WAYPOINT_CONFIG_HOME
    this.configHome = realpathSync(mkdtempSync(join(tmpdir(), 'waypoint-config-home-')))
    process.env.WAYPOINT_CONFIG_HOME = this.configHome
  }

  async mkProjectRoot(prefix = 'waypoint-pg-test-'): Promise<string> {
    // realpath matters: macOS tmpdir() is a /var/folders symlink, but a CLI
    // spawned INSIDE the dir derives its schema from the resolved cwd
    // (/private/var/...) — tracking the symlink string would drop the wrong
    // schema name and silently leak.
    const root = realpathSync(await mkdtemp(join(tmpdir(), prefix)))
    this.roots.push(root)
    return root
  }

  /** Track a project root created elsewhere so its schema is dropped too. */
  track(root: string): void {
    let resolved = root
    try {
      resolved = realpathSync(root)
    } catch {
      // Not on disk (yet/anymore) — track the given string as-is.
    }
    this.roots.push(resolved)
    if (resolved !== root) this.roots.push(root)
  }

  async cleanup(): Promise<void> {
    if (this.savedUrl === undefined) delete process.env.WAYPOINT_POSTGRES_URL
    else process.env.WAYPOINT_POSTGRES_URL = this.savedUrl
    if (this.savedSchema === undefined) delete process.env.WAYPOINT_POSTGRES_SCHEMA
    else process.env.WAYPOINT_POSTGRES_SCHEMA = this.savedSchema
    if (this.hadConfigHome) {
      if (this.savedConfigHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
      else process.env.WAYPOINT_CONFIG_HOME = this.savedConfigHome
    }
    const pool = new pg.Pool({ connectionString: this.url, max: 1 })
    let failed: { schema: string; error: string }[] = []
    try {
      // Per-schema resilience (rsc-g5v): a red run must still drop every OTHER
      // schema it created even if one is stuck or un-droppable.
      ;({ failed } = await dropProjectSchemas(pool, this.roots))
    } finally {
      await pool.end()
    }
    if (failed.length > 0) {
      console.warn(
        `[PostgresTestProjects] cleanup could not drop ${failed.length} schema(s) — inspect and drop by hand:\n  ` +
          failed.map((f) => `${f.schema}: ${f.error}`).join('\n  '),
      )
    }
  }
}
