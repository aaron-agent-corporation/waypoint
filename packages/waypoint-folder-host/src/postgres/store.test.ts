import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import pg from 'pg'

import { appendRouteEvent, readRouteEvents } from '../events/jsonl'
import { initWaypointProject } from '../project/init'
import { createWaypointRoute, getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from '../routes/store'
import { listWaypointTasks, materializeQuestTasks, updateWaypointTask } from '../tasks/store'
import { closeWaypointPostgresPools } from './client'
import { requireTestPostgresUrl } from '../testing/postgres.ts'

/**
 * Integration tests for the postgres route backend (P1). They exercise the
 * PUBLIC store functions on a project whose config selects backend.route:
 * postgres, so the dispatch seam is covered too — the same calls the
 * autopilot, route state machine, and engine make.
 *
 * Requires a live Postgres (the Console-managed instance by default).
 */
// Phase 0, item 10: this used to read WAYPOINT_POSTGRES_TEST_URL raw and skip the
// whole suite when it was unset. A standard install HAS a Postgres — the
// Console manages one under launchd — so the skip fired on ordinary checkouts
// and this coverage simply never ran, while the run still reported green.
// `requireTestPostgresUrl()` defaults to that instance and fails loud at
// connect time if it is genuinely absent, which is the behaviour every other
// durable suite already has.
const TEST_URL = requireTestPostgresUrl()

const schema = `waypoint_test_${process.pid}_${Math.floor(Math.random() * 1e6)}`

async function tempPostgresProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'runner-pg-'))
  await initWaypointProject(projectRoot, {
    quest: 'runner',
    backend: 'postgres',
    postgres: { url: TEST_URL, schema },
  })
  return projectRoot
}

describe('postgres route backend store', () => {
  afterAll(async () => {
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
    await closeWaypointPostgresPools()
  })

  it('creates, lists, and updates routes with folder-store semantics', async () => {
    const projectRoot = await tempPostgresProject()

    const route = await createWaypointRoute(projectRoot, {
      quest: 'runner',
      subject: { type: 'project', id: 'project' },
      current_node: 'initialize',
      now: new Date('2026-07-11T09:00:00.000Z'),
    })
    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'runner',
      status: 'active',
      current_node: 'initialize',
      created_at: '2026-07-11T09:00:00.000Z',
    })

    // Sequential id allocation and duplicate-id rejection match the folder store.
    const second = await createWaypointRoute(projectRoot, { quest: 'runner', subject: { type: 'project', id: 'p2' } })
    expect(second.id).toBe('route-002')
    await expect(
      createWaypointRoute(projectRoot, { id: 'route-001', quest: 'runner', subject: { type: 'project', id: 'dup' } }),
    ).rejects.toThrow('Route already exists: route-001')

    const listed = await listWaypointRoutes(projectRoot)
    expect(listed.map((r) => r.id)).toEqual(['route-001', 'route-002'])

    // Patch semantics: explicit null clears current_node; absent keys survive.
    const updated = await updateWaypointRoute(projectRoot, 'route-001', {
      status: 'blocked',
      current_node: null,
      updated_at: '2026-07-11T09:05:00.000Z',
    })
    expect(updated).toMatchObject({ status: 'blocked', current_node: null, quest: 'runner' })
    expect(await getWaypointRoute(projectRoot, 'route-001')).toMatchObject({
      status: 'blocked',
      current_node: null,
      created_at: '2026-07-11T09:00:00.000Z',
    })
    expect(await getWaypointRoute(projectRoot, 'route-404')).toBeNull()
    await expect(updateWaypointRoute(projectRoot, 'route-404', { status: 'active' })).rejects.toThrow(
      'Route not found: route-404',
    )
  })

  it('materializes quest tasks and updates them like the folder store', async () => {
    const projectRoot = await tempPostgresProject()
    const route = await createWaypointRoute(projectRoot, { quest: 'runner', subject: { type: 'project', id: 'p' } })

    const quest = {
      scaffolds: {
        workstreams: [
          {
            key: 'delivery',
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'build',
                    plans: [
                      { plan_ref: 'intake', title: 'Intake', wave: 10, metadata: { runner: { node: { type: 'checkpoint' } } } },
                      { plan_ref: 'review-gate', title: 'Review gate', wave: 20, metadata: { runner: { gate: { required: true }, node: { type: 'gate' } } } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }

    const tasks = await materializeQuestTasks(projectRoot, { route, quest, now: new Date('2026-07-11T10:00:00.000Z') })
    expect(tasks.map((t) => [t.id, t.plan_ref, t.kind, t.status])).toEqual([
      ['task-001', 'intake', 'checkpoint', 'open'],
      ['task-002', 'review-gate', 'gate', 'open'],
    ])

    // Re-materializing the same route returns the existing tasks (idempotent).
    const again = await materializeQuestTasks(projectRoot, { route, quest })
    expect(again.map((t) => t.id)).toEqual(['task-001', 'task-002'])

    const updated = await updateWaypointTask(projectRoot, 'task-001', {
      status: 'done',
      updated_at: '2026-07-11T10:05:00.000Z',
      metadata: { runner: { autopilot: { status: 'finished' } } },
    })
    expect(updated).toMatchObject({ id: 'task-001', status: 'done', title: 'Intake', wave: 10 })

    const listed = await listWaypointTasks(projectRoot)
    expect(listed.find((t) => t.id === 'task-001')).toMatchObject({
      status: 'done',
      metadata: { runner: { autopilot: { status: 'finished' } } },
    })
    await expect(updateWaypointTask(projectRoot, 'task-404', { status: 'done' })).rejects.toThrow('Task not found: task-404')
  })

  it('surfaces the durable engine evidence column as metadata.runner.evidence without clobbering', async () => {
    const projectRoot = await tempPostgresProject()
    const route = await createWaypointRoute(projectRoot, { quest: 'runner', subject: { type: 'project', id: 'p' } })
    const quest = {
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'build',
                    plans: [
                      { plan_ref: 'engine-task', title: 'Engine task', wave: 10 },
                      { plan_ref: 'store-task', title: 'Store task', wave: 20 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
    const tasks = await materializeQuestTasks(projectRoot, { route, quest })

    // Simulate the engine's write path (B2): status + evidence column, as the
    // compiled df graph does — not through the store API.
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
    await pool.query(
      `UPDATE "${schema}".tasks SET status = 'done', evidence = $2 WHERE id = $1`,
      [tasks[0]!.id, JSON.stringify({ outcome: 'finished', commit: 'abc123' })],
    )
    await pool.end()

    // Store-written metadata.runner.evidence wins over the column.
    await updateWaypointTask(projectRoot, tasks[1]!.id, {
      metadata: { runner: { evidence: { outcome: 'stored' } } },
    })

    const listed = await listWaypointTasks(projectRoot)
    expect(listed.find((t) => t.id === tasks[0]!.id)).toMatchObject({
      status: 'done',
      metadata: { runner: { evidence: { outcome: 'finished', commit: 'abc123' } } },
    })
    expect(listed.find((t) => t.id === tasks[1]!.id)?.metadata).toMatchObject({
      runner: { evidence: { outcome: 'stored' } },
    })
  })

  it('appends and pages route events with folder-store ids and ordering', async () => {
    const projectRoot = await tempPostgresProject()
    const route = await createWaypointRoute(projectRoot, { quest: 'runner', subject: { type: 'project', id: 'p' } })

    const first = await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.started',
      payload: { node: 'intake' },
      now: new Date('2026-07-11T11:00:00.000Z'),
    })
    expect(first).toMatchObject({ id: 'event-001', route_id: route.id, kind: 'route.started', payload: { node: 'intake' } })

    const second = await appendRouteEvent(projectRoot, route.id, { kind: 'route.autopilot.blocked' })
    expect(second.id).toBe('event-002')
    // Payload omitted on append stays omitted on read (not null).
    expect('payload' in second).toBe(false)

    const page = await readRouteEvents(projectRoot, route.id, { limit: 1, offset: 1 })
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(page.items.map((e) => e.id)).toEqual(['event-002'])
    expect('payload' in page.items[0]).toBe(false)

    await expect(readRouteEvents(projectRoot, route.id, { limit: 0 })).rejects.toThrow(
      'Route event limit must be a positive integer: 0',
    )
  })
})
