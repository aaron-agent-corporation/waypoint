import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import pg from 'pg'
import { parse as yamlParse } from 'yaml'

import { deriveProjectSchemaName } from '@waypoint-engine/folder-host'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

/**
 * `waypoint migrate` — the M6 migration tool (P5/F2). Since F3 the product can
 * no longer CREATE folder projects, so the legacy input comes from a
 * checked-in fixture: a real `.waypoint` tree snapshotted from the last
 * pre-retirement build — the bundled `runner` quest run partway (autopilot
 * blocked at plan-approval-gate, 5 tasks finished). The contract under test:
 * retired configs fail closed on every other command, migrate moves the
 * state verbatim, and the migrated route finishes on postgres through the
 * same CLI surface.
 */

const FIXTURE_RUNNER_DIR = fileURLToPath(new URL('./__fixtures__/legacy-folder-project/.waypoint', import.meta.url))

const pgProjects = new PostgresTestProjects()

interface RouteJson {
  route: { id: string; status: string; current_node: string | null }
}
interface TasksJson {
  tasks: Array<{ id: string; plan_ref: string; kind: string; status: string }>
}
interface EventsJson {
  total: number
  items: Array<{ id: string; kind: string; created_at: string }>
}

/** Install catalogs via the live CLI, then overlay the legacy fixture state. */
async function makeLegacyProject(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('migrate-legacy-')
  expect(await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))).toBe(0)
  await cp(FIXTURE_RUNNER_DIR, join(cwd, '.waypoint'), { recursive: true, force: true })
  // Q1 (docs/designs/q-quest-proving.md): the fixture predates the runtime
  // guard (runtime.recipe unset). Opt the legacy project into explicit
  // simulation — migrate preserves runtime verbatim, and the post-migrate
  // `waypoint auto` drive refuses recipe tasks on an unconfigured runtime.
  const configPath = join(cwd, '.waypoint', 'config.yaml')
  await writeFile(configPath, (await readFile(configPath, 'utf8')).replace('recipe: null', "recipe: 'null'"), 'utf8')
  return cwd
}

describe('waypoint migrate (folder → postgres, M6)', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('fails closed on a retired config for every other command, migrates verbatim, and finishes the route on postgres', async () => {
    const cwd = await makeLegacyProject()

    // Fixture facts, read from the fixture itself — no hardcoded twins.
    const fixtureTasks = (yamlParse(await readFile(join(FIXTURE_RUNNER_DIR, 'tasks', 'tasks.yaml'), 'utf8')) as {
      tasks: Array<{ id: string; plan_ref: string; status: string }>
    }).tasks
    const fixtureEventCount = (await readFile(join(FIXTURE_RUNNER_DIR, 'events', 'route-001.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.trim().length > 0).length

    // Judgment call 4: a retired config value ERRORS with migrate guidance.
    await expect(runWaypointCli(['routes', '--json'], makeIo(cwd).io)).rejects.toThrow(
      /route backend is retired.*waypoint migrate/,
    )

    const migrate = makeIo(cwd)
    expect(await runWaypointCli(['migrate', '--json'], migrate.io), `migrate failed: ${migrate.stderr.join('\n')}`).toBe(0)
    const result = JSON.parse(migrate.stdout.join('\n')) as {
      url: string
      schema: string
      routes: number
      tasks: number
      events: number
    }
    expect(result.schema).toBe(deriveProjectSchemaName(cwd))
    expect(result.routes).toBe(1)
    expect(result.tasks).toBe(fixtureTasks.length)
    expect(result.events).toBe(fixtureEventCount)

    // The migrated projection matches the fixture verbatim, plus the
    // route.migrated evidence event appended after the flip.
    const route = makeIo(cwd)
    expect(await runWaypointCli(['route', '--route-id', 'route-001', '--json'], route.io)).toBe(0)
    const routeJson = (JSON.parse(route.stdout.join('\n')) as RouteJson).route
    expect(routeJson.status).toBe('blocked')
    expect(routeJson.current_node).toBe('plan-approval-gate')

    const tasks = makeIo(cwd)
    expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasks.io)).toBe(0)
    const taskRows = (JSON.parse(tasks.stdout.join('\n')) as TasksJson).tasks
    expect(taskRows.map((task) => [task.id, task.plan_ref, task.status])).toEqual(
      fixtureTasks.map((task) => [task.id, task.plan_ref, task.status]),
    )

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--limit', '200', '--json'], events.io)).toBe(0)
    const eventsJson = JSON.parse(events.stdout.join('\n')) as EventsJson
    expect(eventsJson.total).toBe(fixtureEventCount + 1)
    expect(eventsJson.items.at(-1)?.kind).toBe('route.migrated')

    // The migrated route finishes on postgres via the same CLI surface.
    const gates = ['plan-approval-gate', 'verify-approval-gate', 'ship-approval-gate']
    for (const gate of gates) {
      const decide = makeIo(cwd)
      expect(
        await runWaypointCli(['gate', '--route-id', 'route-001', '--node', gate, '--approve', '--note', 'migrate e2e'], decide.io),
        `gate approve failed at ${gate}: ${decide.stderr.join('\n')}`,
      ).toBe(0)
      const drive = makeIo(cwd)
      expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '10', '--json'], drive.io)).toBe(0)
    }
    const final = makeIo(cwd)
    expect(await runWaypointCli(['route', '--route-id', 'route-001', '--json'], final.io)).toBe(0)
    expect((JSON.parse(final.stdout.join('\n')) as RouteJson).route.status).toBe('complete')
    const finalTasks = makeIo(cwd)
    expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], finalTasks.io)).toBe(0)
    const finalRows = (JSON.parse(finalTasks.stdout.join('\n')) as TasksJson).tasks
    for (const gate of gates) {
      expect(finalRows.find((task) => task.plan_ref === gate)?.status, `${gate} status`).toBe('done')
    }
  }, 180000)

  it('refuses a project already on the postgres backend', async () => {
    const cwd = await pgProjects.mkProjectRoot('migrate-already-pg-')
    expect(await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))).toBe(0)
    const migrate = makeIo(cwd)
    expect(await runWaypointCli(['migrate'], migrate.io)).toBe(1)
    expect(migrate.stderr.join('\n')).toContain('already runs the postgres backend')
  })

  it('refuses to migrate into a schema that already holds routes', async () => {
    const cwd = await makeLegacyProject()
    const schema = deriveProjectSchemaName(cwd)

    // Pre-seed the project's derived schema with an existing route row —
    // ensureSchema's CREATE TABLE IF NOT EXISTS adopts the table as-is.
    const pool = new pg.Pool({ connectionString: process.env.WAYPOINT_POSTGRES_URL, max: 1 })
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await pool.query(`CREATE TABLE IF NOT EXISTS "${schema}".routes (id text PRIMARY KEY)`)
    await pool.query(`INSERT INTO "${schema}".routes (id) VALUES ('route-preexisting')`)
    await pool.end()

    const migrate = makeIo(cwd)
    expect(await runWaypointCli(['migrate'], migrate.io)).toBe(1)
    expect(migrate.stderr.join('\n')).toContain('already holds routes')
  }, 60000)
})
