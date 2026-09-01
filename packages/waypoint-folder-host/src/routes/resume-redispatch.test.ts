/**
 * Resuming a FAILED durable run has to dispatch something.
 *
 * A durable run only moves when something signals it, so the old resume —
 * which set the route row to 'active' and appended an event — produced a run
 * that read as running with nothing behind it, forever. Three records
 * requests sat that way for a day after a revoked worker token (2026-07-26):
 * task failed, route resumed, no dispatch, and no way to tell from the
 * Console that the run was dead. The revoked-token case is the one the
 * Console's resume button was BUILT for (runs_service.resume_run), which is
 * exactly why the label alone is not good enough.
 *
 * Requires the live Postgres every durable suite shares.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'
import { PostgresTestProjects, requireTestPostgresUrl } from '../testing/postgres.ts'
import { readRouteEvents } from '../events/jsonl.ts'
import { startAdhocRoute } from './start-adhoc.ts'
import { pauseWaypointRoute, resumeWaypointRoute } from './state.ts'
import { getWaypointRoute, updateWaypointRoute } from './store.ts'

// Phase 0, item 10: this used to read WAYPOINT_POSTGRES_TEST_URL raw and skip the
// whole suite when it was unset. A standard install HAS a Postgres — the
// Console manages one under launchd — so the skip fired on ordinary checkouts
// and this coverage simply never ran, while the run still reported green.
// `requireTestPostgresUrl()` defaults to that instance and fails loud at
// connect time if it is genuinely absent, which is the behaviour every other
// durable suite already has.
const TEST_URL = requireTestPostgresUrl()

const QUEST = `schema_version: 1
slug: resume-demo
name: Resume Demo
workflow: workflows/resume/demo.yaml
recipes:
  - resume-echo
scaffolds:
  workstreams:
    - key: delivery
      name: Delivery
      milestones:
        - version_label: v1
          title: Resume demo
          phases:
            - phase_key: "10"
              phase_slug: run
              lifecycle_phase: execute
              plans:
                - plan_ref: resume-run-echo
                  title: Run the recipe
                  wave: 10
                  metadata:
                    runner:
                      node:
                        type: recipe
                      recipe:
                        slug: resume-echo
`

const RECIPE = `schema_version: 1
slug: resume-echo
name: Resume Echo
prompt: Do the work and report.
`

// Two recipe nodes, so a run can stop with more than one failure on it.
const QUEST_TWO = QUEST.replace(
  /$/,
  `                - plan_ref: resume-run-echo-2
                  title: Run the recipe again
                  wave: 20
                  metadata:
                    runner:
                      node:
                        type: recipe
                      recipe:
                        slug: resume-echo
`,
)

const pgProjects = new PostgresTestProjects()

async function durableRoute(label: string, questYaml: string = QUEST) {
  const root = await pgProjects.mkProjectRoot(label)
  await initWaypointProject(root, {
    quest: 'runner',
    postgres: { url: TEST_URL, durable: true },
    // Never spawned: nothing in this suite drives the bridge.
    runtime: { recipe: 'worker', worker: { command: process.execPath, args: ['-e', 'process.exit(1)'] } },
  })
  const route = await startAdhocRoute(root, {
    sessionId: label,
    questYaml,
    recipeYamls: [RECIPE],
    dryRun: false,
  })
  return { root, route }
}

async function dispatchCount(root: string, routeId: string): Promise<number> {
  const { getWaypointPostgres, quoteIdent } = await import('../postgres/client.ts')
  const { pool, schema } = await getWaypointPostgres(root)
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM ${quoteIdent(schema)}.dispatches WHERE route_id = $1`,
    [routeId],
  )
  return (res.rows[0] as { n: number }).n
}

describe('resuming a durable run', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('re-dispatches the node the run failed on', async () => {
    const { root, route } = await durableRoute('resume-failed-')
    const task = (await listWaypointTasks(root)).find((t) => t.plan_ref === 'resume-run-echo')
    expect(task).toBeDefined()
    await updateWaypointTask(root, task!.id, { status: 'failed', updated_at: new Date().toISOString() })
    // The engine marks the ROUTE failed too — that is the state the operator
    // is looking at when they reach for resume.
    await updateWaypointRoute(root, route.id, { status: 'failed' })
    const before = await dispatchCount(root, route.id)

    const resumed = await resumeWaypointRoute(root, { routeId: route.id })

    expect(resumed.status).toBe('active')
    expect(await dispatchCount(root, route.id)).toBe(before + 1)
    const events = await readRouteEvents(root, route.id)
    const last = events.items[events.items.length - 1]
    expect(last.kind).toBe('route.resumed')
    // The dispatch id is on the event so the trail shows the resume DID
    // something — the whole failure was a resume that looked like it had.
    expect(last.payload).toMatchObject({ previous_status: 'failed', retried_node: 'resume-run-echo' })
    // `dispatches.id` is a bigint, which the driver hands back as a string.
    expect((last.payload as { dispatch_id?: unknown }).dispatch_id).toBeDefined()
  })

  it('resumes a merely paused run on the status alone', async () => {
    const { root, route } = await durableRoute('resume-paused-')
    const before = await dispatchCount(root, route.id)
    await pauseWaypointRoute(root, { routeId: route.id, reason: 'Waiting on review' })

    const resumed = await resumeWaypointRoute(root, { routeId: route.id })

    expect(resumed.status).toBe('active')
    // Nothing failed, so nothing is owed a new attempt.
    expect(await dispatchCount(root, route.id)).toBe(before)
    const events = await readRouteEvents(root, route.id)
    const last = events.items[events.items.length - 1]
    expect(last.payload).toMatchObject({ previous_status: 'blocked' })
    expect(last.payload).not.toHaveProperty('dispatch_id')
  })

  it('refuses to guess which of several failed nodes to retry', async () => {
    const { root, route } = await durableRoute('resume-ambiguous-', QUEST_TWO)
    for (const task of await listWaypointTasks(root)) {
      await updateWaypointTask(root, task.id, { status: 'failed', updated_at: new Date().toISOString() })
    }
    await updateWaypointRoute(root, route.id, { status: 'failed' })
    const before = await dispatchCount(root, route.id)

    // Refusing beats picking: an 'active' route carrying the wrong retry is
    // the same lie in a new costume.
    await expect(resumeWaypointRoute(root, { routeId: route.id })).rejects.toThrow(/failed nodes/i)
    expect((await getWaypointRoute(root, route.id))?.status).toBe('failed')
    expect(await dispatchCount(root, route.id)).toBe(before)
  })
})
