/**
 * Shared test harness for driving the CLI against the postgres route
 * backend — captured/silent IO shims plus per-suite postgres project
 * tracking. Since the folder backend retired (P5), suites that touch
 * route/task/event state REQUIRE a live Postgres and fail LOUD without
 * WAYPOINT_POSTGRES_TEST_URL so a green run can never silently shrink.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'

import { dropProjectSchemas } from '@waypoint-engine/folder-host'

/** The Console-managed local Postgres — see the folder-host harness for why
 * the `waypoint` role (not the login user) is the one that works. */
export const CONSOLE_POSTGRES_TEST_URL = 'postgres://waypoint@127.0.0.1:5433/postgres'

export function requireTestPostgresUrl(): string {
  return process.env.WAYPOINT_POSTGRES_TEST_URL?.trim() || CONSOLE_POSTGRES_TEST_URL
}

/**
 * Tracks temp project roots and drops their derived per-project schemas on
 * cleanup. Usage: `setEnv()` in beforeAll (points resolution at the test
 * instance), `mkProjectRoot()` per project, `cleanup()` in afterAll.
 * Init projects with `--postgres-no-durable` when `waypoint auto` drives them.
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

export interface CapturedIo {
  readonly io: {
    readonly cwd: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
  }
  readonly stdout: string[]
  readonly stderr: string[]
}

export function silentIo(cwd: string) {
  return { cwd, stdout: () => undefined, stderr: () => undefined }
}

export function makeIo(cwd: string): CapturedIo {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}
