import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import pg from 'pg'

import {
  cancelSchemaDurableInstances,
  compileQuestToDurableGraph,
  dispatchChannelName,
  loadBundledWaypointCatalog,
  readBridgeRegistryRecord,
  runWaypointBridge,
  type WaypointBridgeRecipeRuntime,
  type WaypointBridgeRecipeRuntimeInput,
} from '@waypoint-engine/folder-host'

import { runWaypointCli } from '../bin'
import { makeIo, silentIo } from '../testing/backend-harness'
import { requireTestPgDurableUrl } from '../../../waypoint-folder-host/src/testing/postgres.ts'

/**
 * A catalog this suite OWNS.
 *
 * These tests need a quest with a settled shape — two sequential recipe
 * plans, a gate per wave, a repeat variant — and used to borrow the product's
 * `code-review` quest for it. D6 deleted that quest, and all 27 tests here
 * broke the same day. Nobody noticed, because the suite was skip-gated on
 * WAYPOINT_PGDURABLE_TEST_URL and had been reporting green over an empty set.
 * The fixture is the deleted quest and its two recipes, kept here where a
 * product decision cannot reach them (Phase 0, item 10).
 */
const FIXTURE_CATALOG = fileURLToPath(new URL('../testing/fixtures/catalog', import.meta.url))


/**
 * B3 bridge E2E (docs/designs/p2-waypoint-on-pgdurable.md): the dispatch bridge
 * closes the loop against a REAL pg_durable engine — the compiled retry loop,
 * the dispatches queue with its NOTIFY trigger, outcome signals with the
 * confirm-consumption protocol, and retry-with-evidence.
 *
 * Requires a PostgreSQL with the pg_durable extension installed and the
 * connecting role granted via df.grant_usage — the Console-managed instance
 * (postgresql://waypoint@localhost:5433/postgres). A plain Postgres is NOT
 * enough: these tests park real waits.
 */
// Phase 0, item 10: `WAYPOINT_PGDURABLE_TEST_URL` dates from the spike, when a
// durable Postgres was a separate container. Since P5 the Console-managed
// instance carries pg_durable and is durable by default, so gating on that
// variable skipped this suite on every ordinary checkout while the run
// reported green. requireTestPgDurableUrl() defaults to that instance.
const TEST_URL = requireTestPgDurableUrl()

const SCHEMAS: string[] = []

function freshSchema(prefix: string): string {
  const schema = `${prefix}_${process.pid}_${Math.floor(Math.random() * 1e6)}`
  SCHEMAS.push(schema)
  return schema
}

class ScriptedRuntime implements WaypointBridgeRecipeRuntime {
  readonly calls: WaypointBridgeRecipeRuntimeInput[] = []
  constructor(private readonly script: (input: WaypointBridgeRecipeRuntimeInput, call: number) => { status: string } & Record<string, unknown>) {}
  async runRecipe(input: WaypointBridgeRecipeRuntimeInput): Promise<{ status: string }> {
    this.calls.push(input)
    return this.script(input, this.calls.length)
  }
}

async function initDurableProject(schema: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'bridge-e2e-'))
  expect(
    await runWaypointCli(
      ['init', '--quest', 'code-review', '--backend', 'postgres', '--postgres-url', TEST_URL, '--postgres-schema', schema, '--postgres-durable', '--simulated'],
      silentIo(cwd),
    ),
  ).toBe(0)
  expect(await runWaypointCli(['start', '--quest', 'code-review'], silentIo(cwd))).toBe(0)
  return cwd
}

async function routeState(pool: pg.Pool, schema: string): Promise<{ status: string; node: string | null }> {
  const result = await pool.query(`SELECT status, current_node FROM "${schema}".routes WHERE id = 'route-001'`)
  const row = result.rows[0] as { status: string; current_node: string | null } | undefined
  return { status: row?.status ?? 'missing', node: row?.current_node ?? null }
}

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await probe()
    if (accept(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`timed out waiting for ${label}; last: ${JSON.stringify(last)}`)
}

describe('durable dispatch bridge + gates (B3/B4, real pg_durable engine)', () => {
  // A1: durable starts write the bridge registry — sandbox it away from the
  // operator's real ~/.waypoint for the whole suite.
  let savedConfigHome: string | undefined
  let savedCatalogRoot: string | undefined
  beforeAll(() => {
    savedConfigHome = process.env.WAYPOINT_CONFIG_HOME
    process.env.WAYPOINT_CONFIG_HOME = realpathSync(mkdtempSync(join(tmpdir(), 'waypoint-config-home-')))
    // `waypoint init` resolves the bundled catalog; point it at this suite's own.
    savedCatalogRoot = process.env.WAYPOINT_CATALOG_ROOT
    process.env.WAYPOINT_CATALOG_ROOT = FIXTURE_CATALOG
  })

  afterAll(async () => {
    if (savedConfigHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
    else process.env.WAYPOINT_CONFIG_HOME = savedConfigHome
    if (savedCatalogRoot === undefined) delete process.env.WAYPOINT_CATALOG_ROOT
    else process.env.WAYPOINT_CATALOG_ROOT = savedCatalogRoot
    if (!TEST_URL) return
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
    for (const schema of SCHEMAS) {
      await cancelSchemaDurableInstances(pool, schema)
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
    await pool.end()
  })

  it('A1 registry: a durable route start registers the project for the bridge supervisor', async () => {
    const schema = freshSchema('waypoint_bridge_reg')
    const cwd = await initDurableProject(schema)
    const record = await readBridgeRegistryRecord(cwd)
    expect(record, 'registry record written under WAYPOINT_CONFIG_HOME/bridges').not.toBeNull()
    expect(record?.project_root).toBe(realpathSync(cwd))
    expect(record?.schema).toBe(schema)
    expect(Date.parse(record?.registered_at ?? '')).not.toBeNaN()
  })

  it('A1 park: the daemon bridge stays up while the route is live, then exits cleanly once nothing is', async () => {
    const schema = freshSchema('waypoint_bridge_idle')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'park e2e' }))
      const events: string[] = []
      // Daemon mode with idle-exit: returning AT ALL is the park behavior
      // under test — hasLiveWork holds it open until the route is terminal.
      const result = await runWaypointBridge(cwd, {
        runtime,
        idleExitMs: 3_000,
        pollIntervalMs: 500,
        onEvent: (event) => events.push(event),
      })
      expect((await routeState(pool, schema)).status).toBe('complete')
      expect(result.processed.length).toBeGreaterThan(0)
      expect(result.processed.every((item) => item.outcome === 'finished' && item.engine_advanced)).toBe(true)
      expect(events.some((event) => event.includes('parking'))).toBe(true)
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('rsc-9y6: the daemon bridge writes the dossier itself when the route goes terminal — no agent in the loop', async () => {
    const schema = freshSchema('waypoint_bridge_dossier')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    // Point the Console lookup at a closed port: the dossier must be written from
    // the postgres record alone. Otherwise this test would pass or fail depending
    // on whether the OPERATOR's Console happened to be running, and session
    // linkage is dossier.test.ts's job, not this one's.
    const savedConsole = process.env.WAYPOINT_CONSOLE_URL
    process.env.WAYPOINT_CONSOLE_URL = 'http://127.0.0.1:1'
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'dossier e2e' }))
      const events: string[] = []
      await runWaypointBridge(cwd, { runtime, idleExitMs: 3_000, pollIntervalMs: 500, onEvent: (event) => events.push(event) })

      expect((await routeState(pool, schema)).status).toBe('complete')

      // THE POINT: nobody ran `waypoint dossier`. Until this change a dossier
      // existed only if the orchestrator remembered to ask for one, so a run that
      // crashed or was cancelled — the run most worth reviewing — left no record.
      const markdown = join(cwd, '.waypoint', 'reports', 'route-001', 'dossier.md')
      const json = join(cwd, '.waypoint', 'reports', 'route-001', 'dossier.json')
      expect(existsSync(markdown), 'no dossier: the bridge did not observe the route reach terminal state').toBe(true)
      expect(existsSync(json)).toBe(true)
      expect(events.some((event) => event.includes('dossier written for terminal route route-001'))).toBe(true)

      // It is the real record, assembled from postgres — not an empty stub.
      const body = await readFile(markdown, 'utf8')
      expect(body).toContain('route-001')
      const record = JSON.parse(await readFile(json, 'utf8')) as { route?: { status?: string } }
      expect(record.route?.status).toBe('complete')
    } finally {
      if (savedConsole === undefined) delete process.env.WAYPOINT_CONSOLE_URL
      else process.env.WAYPOINT_CONSOLE_URL = savedConsole
      await pool.end()
    }
  }, 120_000)

  it('rsc-9y6: the dossier is written ONCE — a re-run does not rewrite it', async () => {
    const schema = freshSchema('waypoint_bridge_dossier_idem')
    const cwd = await initDurableProject(schema)
    const savedConsole = process.env.WAYPOINT_CONSOLE_URL
    process.env.WAYPOINT_CONSOLE_URL = 'http://127.0.0.1:1'
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'idempotence e2e' }))
      await runWaypointBridge(cwd, { runtime, idleExitMs: 2_000, pollIntervalMs: 500 })
      const markdown = join(cwd, '.waypoint', 'reports', 'route-001', 'dossier.md')
      const first = await readFile(markdown, 'utf8')

      // A respawned bridge (the Console parks them after idle and brings them
      // back) has an empty in-memory set, so the FILE is what stops a rewrite.
      const events: string[] = []
      await runWaypointBridge(cwd, { runtime, idleExitMs: 2_000, pollIntervalMs: 500, onEvent: (event) => events.push(event) })
      expect(await readFile(markdown, 'utf8'), 'the dossier was rewritten by a later bridge').toBe(first)
      expect(events.some((event) => event.includes('dossier written'))).toBe(false)
    } finally {
      if (savedConsole === undefined) delete process.env.WAYPOINT_CONSOLE_URL
      else process.env.WAYPOINT_CONSOLE_URL = savedConsole
    }
  }, 120_000)

  it('drives the code-review quest to complete: dispatches claimed, outcomes signalled and confirmed', async () => {
    const schema = freshSchema('waypoint_bridge')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'bridge e2e' }))

      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true, runtime })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion',
        90_000,
      )

      expect(runtime.calls.map((call) => call.recipe)).toEqual(['runner-code-reviewer', 'runner-code-fixer'])

      const tasks = makeIo(cwd)
      expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasks.io)).toBe(0)
      const parsed = JSON.parse(tasks.stdout.join('\n')) as {
        tasks: Array<{ plan_ref: string; status: string; metadata?: { runner?: { evidence?: { summary?: string } } } }>
      }
      expect(parsed.tasks.every((task) => task.status === 'done')).toBe(true)
      const reviewer = parsed.tasks.find((task) => task.plan_ref === 'code-review-run-code-reviewer')
      expect(reviewer?.metadata?.runner?.evidence?.summary).toBe('bridge e2e')

      const dispatches = await pool.query(`SELECT status, close_reason FROM "${schema}".dispatches ORDER BY id`)
      expect(dispatches.rows).toEqual([
        { status: 'completed', close_reason: 'finished' },
        { status: 'completed', close_reason: 'finished' },
      ])
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('an account refusal re-queues the work instead of failing the task', async () => {
    // "Don't just die because one subscription hit a limit when I've got eight
    // subscriptions" (Aaron 2026-08-02): the medical-layer extraction was
    // recorded as a failed task when kimi's billing cycle ran out mid-run.
    const schema = freshSchema('waypoint_bridge_refusal')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      let refusals = 0
      const runtime = new ScriptedRuntime((input) => {
        if (input.recipe === 'runner-code-reviewer' && refusals === 0) {
          refusals += 1
          return {
            status: 'failed',
            close_reason: 'process exited 1',
            stdout: "403 You've reached your usage limit for this billing cycle.",
          }
        }
        return { status: 'finished', summary: 'served by another lane' }
      })

      const refused = await until(
        async () => (await runWaypointBridge(cwd, { once: true, runtime })).processed,
        (rows) => rows.some((row) => row.account_refusal !== undefined),
        'the refused dispatch',
      )
      expect(refused.find((row) => row.account_refusal)!.account_refusal).toContain(
        'usage limit for this billing cycle',
      )

      // The invariant: a refusal leaves NO failed attempt behind. The task was
      // never marked failed and no failure event was recorded, so the work is
      // still the queue's — a later pass, another lane, carries it on.
      const failures = await pool.query(
        `SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind = 'route.bridge.task.failed'`,
      )
      expect(failures.rows[0]).toEqual({ n: 0 })

      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime })
          return await routeState(pool, schema)
        },
        (route) => route.node !== 'code-review-run-code-reviewer' || route.status === 'complete',
        'the work carried on after the refusal',
        90_000,
      )
      const task = await pool.query(
        `SELECT status FROM "${schema}".tasks WHERE plan_ref = 'code-review-run-code-reviewer'`,
      )
      expect(task.rows[0]!.status).not.toBe('failed')
      expect(refusals).toBe(1)
    } finally {
      await pool.end()
    }
  })

  it('retry-with-evidence: a failed attempt is recorded off-graph and auto-requeued; the retry carries the prior evidence', async () => {
    const schema = freshSchema('waypoint_bridge_retry')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      let failedOnce = false
      const runtime = new ScriptedRuntime((input) => {
        if (input.recipe === 'runner-code-reviewer' && !failedOnce) {
          failedOnce = true
          return { status: 'failed', close_reason: 'runtime_error', stdout: 'reviewer exploded' }
        }
        return { status: 'finished', summary: 'retry e2e' }
      })

      // The failure is recorded off-graph (task failed + evidence, event),
      // bounded auto-retry (rsc-m23.6) queues the next attempt itself, and —
      // because a draining bridge claims its own retry (rsc-6js4) — the same
      // pass carries the route the rest of the way. The intermediate states
      // are gone before they can be queried, so the story is asserted from
      // the durable record: the event trail, the dispatch rows, and the
      // evidence handed to the retry attempt.
      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime })
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion through the auto-retry',
        90_000,
      )

      const events = await pool.query(
        `SELECT kind, count(*)::int AS n FROM "${schema}".route_events
          WHERE kind IN ('route.bridge.task.failed', 'task.retry.auto') GROUP BY kind ORDER BY kind`,
      )
      expect(events.rows).toEqual([
        { kind: 'route.bridge.task.failed', n: 1 },
        { kind: 'task.retry.auto', n: 1 },
      ])

      // Three dispatches: the failed attempt, its auto-queued retry, the fixer.
      const dispatches = await pool.query(
        `SELECT task_ref, close_reason FROM "${schema}".dispatches ORDER BY id`,
      )
      expect(dispatches.rows).toEqual([
        { task_ref: 'code-review-run-code-reviewer', close_reason: 'failed' },
        { task_ref: 'code-review-run-code-reviewer', close_reason: 'finished' },
        { task_ref: 'code-review-run-code-fixer', close_reason: 'finished' },
      ])

      // Every task ended done — the failed attempt left no lasting mark.
      const tasks = await pool.query(`SELECT status FROM "${schema}".tasks`)
      expect((tasks.rows as { status: string }[]).every((row) => row.status === 'done')).toBe(true)

      // The retry run carried the failed attempt's engine-recorded evidence.
      const retryCall = runtime.calls.filter((call) => call.recipe === 'runner-code-reviewer')[1]
      expect(retryCall?.priorAttempt).toEqual({
        status: 'failed',
        close_reason: 'runtime_error',
        missing: [],
        output_tail: 'reviewer exploded',
      })
    } finally {
      await pool.end()
    }
  }, 150_000)

  it('rsc-6js4 + rsc-3srd: ONE daemon bridge carries a failed attempt through auto-retry to completion', async () => {
    // The in-vivo proof (retry-proof case, route-003, 2026-08-08) needed three
    // bridges for three attempts: a laneless project's pool holds one
    // synthetic null-named lane that is never returned after its first
    // dispatch, so the daemon starved while `hasLiveWork` kept it alive.
    // The whole point of auto-retry is a run that recovers with NOBODY in the
    // loop — one daemon, one failure, and the route must still end complete.
    const schema = freshSchema('waypoint_bridge_daemon_retry')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      let failedOnce = false
      const runtime = new ScriptedRuntime((input) => {
        if (input.recipe === 'runner-code-reviewer' && !failedOnce) {
          failedOnce = true
          return { status: 'failed', close_reason: 'flaky once', stdout: 'first attempt crashed' }
        }
        return { status: 'finished', summary: 'daemon retry e2e' }
      })

      // One daemon-mode call, no operator: it must claim the first dispatch,
      // record the failure, claim its own auto-retry dispatch, and keep
      // claiming until the engine settles the route.
      const result = await runWaypointBridge(cwd, { runtime, idleExitMs: 4_000, pollIntervalMs: 300 })

      const outcomes = result.processed.map((row) => row.outcome)
      expect(outcomes.filter((o) => o === 'failed')).toHaveLength(1)
      // The failed attempt, its retry, and the rest of the quest — all this bridge.
      expect(result.processed.length).toBeGreaterThanOrEqual(3)

      expect((await routeState(pool, schema)).status).toBe('complete')
      const tasks = await pool.query(`SELECT plan_ref, status FROM "${schema}".tasks ORDER BY id`)
      expect((tasks.rows as { status: string }[]).every((row) => row.status === 'done')).toBe(true)
      const retryEvents = await pool.query(
        `SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind = 'task.retry.auto'`,
      )
      expect(retryEvents.rows[0]).toEqual({ n: 1 })
    } finally {
      await pool.end()
    }
  }, 150_000)

  it('durable gates (B4): reject records and re-parks, wrong node is refused, approve advances to completion', async () => {
    const schema = freshSchema('waypoint_gate')
    const cwd = await mkdtemp(join(tmpdir(), 'gate-e2e-'))
    expect(
      await runWaypointCli(
        ['init', '--quest', 'runner', '--backend', 'postgres', '--postgres-url', TEST_URL, '--postgres-schema', schema, '--postgres-durable', '--simulated'],
        silentIo(cwd),
      ),
    ).toBe(0)
    expect(await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))).toBe(0)

    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'gate e2e' }))
      const driveTo = (accept: (route: { status: string; node: string | null }) => boolean, label: string) =>
        until(
          async () => {
            await runWaypointBridge(cwd, { once: true, runtime })
            return await routeState(pool, schema)
          },
          accept,
          label,
          120_000,
        )

      await driveTo((route) => route.status === 'blocked' && route.node === 'plan-approval-gate', 'first gate')
      // The ROUTE row and the gate TASK row settle on separate writes — the
      // task can still read 'open' for a pass after the route blocks, and the
      // reject below touches neither, so the post-reject assertion was a
      // 1-in-3 flake when it read the task exactly once (2026-08-25). Settle
      // the task here; after that every later single read is deterministic.
      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime })
          const row = await pool.query(`SELECT status FROM "${schema}".tasks WHERE plan_ref = 'plan-approval-gate'`)
          return (row.rows[0] as { status: string } | undefined)?.status ?? 'missing'
        },
        (status) => status === 'blocked',
        'gate task parked at plan-approval-gate',
        120_000,
      )

      // The current-gate guard holds on the durable path: deciding a gate
      // that is not the route's current node is refused.
      const wrongNode = makeIo(cwd)
      expect(
        await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'ship-approval-gate', '--approve'], wrongNode.io),
      ).toBe(1)
      expect(wrongNode.stderr.join('\n')).toContain('not the current gate')

      // Reject: recorded off-graph (P1 folder parity) — the rejected event is
      // appended, the route stays blocked at the gate, the engine's wait
      // stays parked, and the gate stays decidable. The gate task is
      // untouched (still 'blocked'); only an approve makes the engine write.
      const reject = makeIo(cwd)
      expect(
        await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--reject', '--note', 'not yet'], reject.io),
      ).toBe(0)
      const afterReject = await pool.query(`SELECT status FROM "${schema}".tasks WHERE plan_ref = 'plan-approval-gate'`)
      expect(afterReject.rows[0]).toEqual({ status: 'blocked' })
      const rejectedEvent = await pool.query(
        `SELECT payload FROM "${schema}".route_events WHERE kind = 'route.gate.rejected' ORDER BY ord DESC LIMIT 1`,
      )
      expect(rejectedEvent.rows[0]?.payload).toMatchObject({ node: 'plan-approval-gate', note: 'not yet' })
      expect(await routeState(pool, schema)).toEqual({ status: 'blocked', node: 'plan-approval-gate' })

      // Approve the re-parked gate; then drive the rest of the quest,
      // approving the remaining gates as the route parks at them.
      const approve = makeIo(cwd)
      expect(
        await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--approve', '--note', 'go'], approve.io),
        `approve after reject failed: ${approve.stderr.join('\n')}`,
      ).toBe(0)
      expect(approve.stdout.join('\n')).toContain('Approved gate plan-approval-gate')

      for (const gate of ['verify-approval-gate', 'ship-approval-gate']) {
        await driveTo((route) => route.status === 'blocked' && route.node === gate, `parked at ${gate}`)
        expect(await runWaypointCli(['gate', '--route-id', 'route-001', '--node', gate, '--approve'], silentIo(cwd))).toBe(0)
      }
      await driveTo((route) => route.status === 'complete', 'route completion')

      // The event surface carries the rejected decision and all three approvals.
      const events = await pool.query(
        `SELECT kind, count(*)::int AS n FROM "${schema}".route_events WHERE kind LIKE 'route.gate.%' GROUP BY kind ORDER BY kind`,
      )
      expect(events.rows).toEqual([
        { kind: 'route.gate.approved', n: 3 },
        { kind: 'route.gate.rejected', n: 1 },
      ])
      const gateTask = await pool.query(`SELECT status FROM "${schema}".tasks WHERE plan_ref = 'plan-approval-gate'`)
      expect(gateTask.rows[0]).toEqual({ status: 'done' })
    } finally {
      await pool.end()
    }
  }, 300_000)

  it('dispatch inserts notify the bridge channel (LISTEN/NOTIFY push path)', async () => {
    const schema = freshSchema('waypoint_bridge_notify')
    await initDurableProject(schema)

    const listener = new pg.Client({ connectionString: TEST_URL })
    await listener.connect()
    try {
      const heard = new Promise<string>((resolve) => listener.on('notification', (msg) => resolve(msg.channel)))
      await listener.query(`LISTEN "${dispatchChannelName(schema)}"`)
      const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 })
      await pool.query(
        `INSERT INTO "${schema}".dispatches (route_id, task_ref, recipe, instance_id) VALUES ('route-001', 'probe', 'probe-recipe', 'probe-iid')`,
      )
      await pool.end()
      expect(await Promise.race([heard, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('no NOTIFY within 5s')), 5_000))])).toBe(
        dispatchChannelName(schema),
      )
    } finally {
      await listener.end()
    }
  }, 30_000)

  it('engine INSERT nodes are idempotent under re-execution (B4.5: nodes are at-least-once)', async () => {
    const schema = freshSchema('waypoint_bridge_replay')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'replay e2e' }))
      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime })
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion',
        90_000,
      )

      // The route status flips 'complete' one node BEFORE the final
      // route.complete event insert — wait for that too, or the count
      // baseline below races the engine's last write.
      await until(
        async () => {
          const result = await pool.query(`SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind = 'route.complete'`)
          return (result.rows[0] as { n: number }).n
        },
        (n) => n === 1,
        'the route.complete event',
      )

      // Re-execute the route's ACTUAL compiled INSERT nodes (the exact SQL a
      // crashed-then-resumed duroxide activity would run again) and assert
      // they no-op: no duplicate worker dispatch, no duplicate event.
      const instance = await pool.query(`SELECT instance_id FROM "${schema}".routes WHERE id = 'route-001'`)
      const instanceId = (instance.rows[0] as { instance_id: string }).instance_id
      expect(instanceId).toBeTruthy()

      const catalog = await loadBundledWaypointCatalog({ root: FIXTURE_CATALOG })
      const quest = catalog.quests.get('code-review')
      expect(quest).toBeDefined()
      const compiled = compileQuestToDurableGraph({ routeId: 'route-001', schema, quest: quest! })
      const inserts: string[] = []
      for (const match of compiled.matchAll(/\$(n\d+x*)\$([\s\S]*?)\$\1\$/g)) {
        const body = match[2]
        if (body.includes('INSERT INTO') && !body.includes('$sig')) {
          inserts.push(body.replaceAll('{sys_instance_id}', instanceId))
        }
      }
      // Both dispatch inserts + the signal-free event inserts must be covered.
      expect(inserts.filter((sql) => sql.includes('.dispatches')).length).toBe(2)
      expect(inserts.filter((sql) => sql.includes('.route_events')).length).toBeGreaterThanOrEqual(2)

      const counts = async () => {
        const result = await pool.query(
          `SELECT (SELECT count(*)::int FROM "${schema}".dispatches) AS dispatches,
                  (SELECT count(*)::int FROM "${schema}".route_events) AS events`,
        )
        return result.rows[0] as { dispatches: number; events: number }
      }
      const before = await counts()
      for (const sql of inserts) await pool.query(sql)
      expect(await counts()).toEqual(before)
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('reclaims dispatches orphaned by a dead bridge (B4.5: claim leases)', async () => {
    const schema = freshSchema('waypoint_bridge_lease')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // Simulate a bridge that claimed the first dispatch and died mid-attempt:
      // status stuck at 'running' with a long-stale claim (a live bridge would
      // be heartbeating claimed_at).
      const orphan = await until(
        async () => {
          const result = await pool.query(
            `UPDATE "${schema}".dispatches SET status = 'running', claimed_at = now() - interval '1 hour'
             WHERE status = 'pending' RETURNING id`,
          )
          return result.rows.length
        },
        (updated) => updated > 0,
        'a pending dispatch to orphan',
      )
      expect(orphan).toBe(1)

      const events: string[] = []
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'lease e2e' }))
      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime, onEvent: (event) => events.push(event) })
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion after reclaim',
        90_000,
      )

      expect(events.some((event) => event.includes('reclaimed from a stale claim'))).toBe(true)
      const dispatches = await pool.query(`SELECT status, close_reason FROM "${schema}".dispatches ORDER BY id`)
      expect(dispatches.rows).toEqual([
        { status: 'completed', close_reason: 'finished' },
        { status: 'completed', close_reason: 'finished' },
      ])
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('agent report seam (W1): reports land on the claimed dispatch, first write wins', async () => {
    const schema = freshSchema('waypoint_report')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // The engine inserts the first dispatch; simulate the host claiming it
      // (the worker runtime will do this in W3/W4).
      const claimed = await until(
        async () => {
          const result = await pool.query(
            `UPDATE "${schema}".dispatches SET status = 'running', claimed_at = now()
             WHERE status = 'pending' RETURNING task_ref`,
          )
          return result.rows.length
        },
        (n) => n > 0,
        'a pending dispatch to claim',
      )
      expect(claimed).toBe(1)

      const tasksOut = makeIo(cwd)
      expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasksOut.io)).toBe(0)
      const inProgress = (JSON.parse(tasksOut.stdout.join('\n')) as { tasks: Array<{ id: string; status: string; kind: string }> }).tasks
        .find((task) => task.kind === 'recipe' && task.status === 'in_progress')
      expect(inProgress).toBeDefined()
      const taskId = inProgress!.id

      // No-running-attempt refusal: a different task has no claimed dispatch.
      const other = (JSON.parse(tasksOut.stdout.join('\n')) as { tasks: Array<{ id: string; kind: string; status: string }> }).tasks
        .find((task) => task.kind === 'recipe' && task.status !== 'in_progress')
      if (other) {
        const refused = makeIo(cwd)
        expect(await runWaypointCli(['tasks', 'report', other.id, '--status', 'finished', '--summary', 'nope'], refused.io)).toBe(1)
        expect(refused.stderr.join('\n')).toContain('No running attempt')
      }

      // The agent reports through the CLI.
      const report = makeIo(cwd)
      expect(
        await runWaypointCli(
          ['tasks', 'report', taskId, '--status', 'finished', '--summary', 'reviewed the diff', '--evidence', 'commit=abc123'],
          report.io,
        ),
        report.stderr.join('\n'),
      ).toBe(0)
      expect(report.stdout.join('\n')).toContain('the report is your claim, not the verdict')

      const row = await pool.query(`SELECT report FROM "${schema}".dispatches WHERE status = 'running'`)
      expect(row.rows[0]?.report).toMatchObject({
        status: 'finished',
        summary: 'reviewed the diff',
        evidence: { commit: 'abc123' },
      })

      // First write wins.
      const second = makeIo(cwd)
      expect(await runWaypointCli(['tasks', 'report', taskId, '--status', 'failed', '--summary', 'changed my mind'], second.io)).toBe(1)
      expect(second.stderr.join('\n')).toContain('already has a report')

      // The show view surfaces the attempt and its report as data.
      const show = makeIo(cwd)
      expect(await runWaypointCli(['tasks', 'show', taskId, '--json'], show.io)).toBe(0)
      const parsed = JSON.parse(show.stdout.join('\n')) as { attempt: { status: string; report: { summary: string } } }
      expect(parsed.attempt.status).toBe('running')
      expect(parsed.attempt.report.summary).toBe('reviewed the diff')
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- W4: the host loop (docs/designs/p3-worker-host.md) ------------------
  // These two run against the Waypoint tables WITHOUT parking engine waits: the
  // scripted attempts end failed/stopped, which the bridge records off-graph
  // (or, on a lost lease, not at all), so no df instance is needed.

  /** Init only (no `waypoint start`): rows are inserted directly so the pool
   * and lease behavior can be tested without a live engine instance. */
  async function initDurableProjectNoStart(schema: string): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'bridge-w4-'))
    expect(
      await runWaypointCli(
        ['init', '--quest', 'code-review', '--backend', 'postgres', '--postgres-url', TEST_URL, '--postgres-schema', schema, '--postgres-durable', '--simulated'],
        silentIo(cwd),
      ),
    ).toBe(0)
    return cwd
  }

  async function seedRouteWithDispatches(pool: pg.Pool, cwd: string, schema: string, count: number): Promise<void> {
    // Ensure the schema DDL exists without starting an engine instance.
    const { latestDurableTaskAttempt } = await import('@waypoint-engine/folder-host')
    await latestDurableTaskAttempt(cwd, 'no-such-task')
    const now = new Date().toISOString()
    await pool.query(
      `INSERT INTO "${schema}".routes (id, quest, status, current_node, subject, created_at, updated_at, instance_id)
       VALUES ('route-001', 'code-review', 'active', NULL, '{}'::jsonb, $1, $1, 'w4-fake-instance')`,
      [now],
    )
    for (let i = 1; i <= count; i++) {
      await pool.query(
        `INSERT INTO "${schema}".tasks (id, route_id, plan_ref, title, phase, wave, kind, status, created_at, updated_at)
         VALUES ($1, 'route-001', $2, $3, 'run', 1, 'recipe', 'open', $4, $4)`,
        [`task-w4-${i}`, `node-${i}`, `W4 task ${i}`, now],
      )
      await pool.query(
        `INSERT INTO "${schema}".dispatches (route_id, task_ref, recipe, instance_id)
         VALUES ('route-001', $1, 'runner-code-reviewer', 'w4-fake-instance')`,
        [`node-${i}`],
      )
    }
  }

  it('W4 host pool: three dispatches run concurrently under --concurrency 3', async () => {
    const schema = freshSchema('waypoint_w4_pool')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      await seedRouteWithDispatches(pool, cwd, schema, 3)
      const ATTEMPT_MS = 1_200
      // A CONSTANT close reason: bounded auto-retry (rsc-m23.6) re-queues a
      // first failure, and the same-reason brake stops the second — so each
      // seeded task runs exactly twice and the drain settles at 6 attempts.
      // (A reason-less failure would retry to max_attempts instead.)
      const runtime = new ScriptedRuntime(() => ({ status: 'failed', close_reason: 'w4 pool probe', summary: 'w4 pool probe' }))
      const slowRuntime = {
        runRecipe: async (input: WaypointBridgeRecipeRuntimeInput) => {
          await new Promise((resolve) => setTimeout(resolve, ATTEMPT_MS))
          return runtime.runRecipe(input)
        },
      }

      const started = Date.now()
      const result = await runWaypointBridge(cwd, { once: true, runtime: slowRuntime, concurrency: 3 })
      const elapsed = Date.now() - started

      expect(result.processed).toHaveLength(6)
      expect(result.processed.map((item) => item.outcome)).toEqual(Array(6).fill('failed'))
      // Six sequential attempts would be >= 6 * ATTEMPT_MS; two overlapped
      // rounds of three fit well under half that. The pool overlaps.
      expect(elapsed, `pool did not overlap attempts (took ${elapsed}ms)`).toBeLessThan(3 * ATTEMPT_MS)

      const dispatches = await pool.query(`SELECT status, close_reason FROM "${schema}".dispatches ORDER BY id`)
      expect(dispatches.rows).toEqual(
        Array(6).fill({ status: 'completed', close_reason: 'failed' }),
      )
    } finally {
      await pool.end()
    }
  }, 120_000)

  // The 2026-08-25 ledger entry: the dispatch row's close_reason is only the
  // outcome word, so an operator staring at `tasks show` saw bare 'failed'
  // and re-ran the tool by hand to learn what the failure event already
  // recorded. The attempt surface now reads the event's real reason + stderr.
  it("tasks show surfaces the failed attempt's real reason and stderr from the record", async () => {
    const schema = freshSchema('waypoint_w4_showfail')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      await seedRouteWithDispatches(pool, cwd, schema, 1)
      const runtime = new ScriptedRuntime(() => ({
        status: 'failed',
        close_reason: 'deterministic step exited 2: cite-check: FAILED — no cite records judged',
        stderr: 'cite-check: skipped sources.json\ncite-check: FAILED — no cite records judged',
        summary: 'showfail probe',
      }))
      await runWaypointBridge(cwd, { once: true, runtime })

      const { latestDurableTaskAttempt } = await import('@waypoint-engine/folder-host')
      const attempt = await latestDurableTaskAttempt(cwd, 'task-w4-1')
      expect(attempt?.close_reason).toBe('failed')
      expect(attempt?.failure_detail).toContain('deterministic step exited 2: cite-check: FAILED')
      expect(attempt?.failure_stderr).toContain('skipped sources.json')

      const show = makeIo(cwd)
      expect(await runWaypointCli(['tasks', 'show', 'task-w4-1'], show.io)).toBe(0)
      const text = show.stdout.join('\n')
      expect(text).toContain('failure:')
      expect(text).toContain('deterministic step exited 2: cite-check: FAILED — no cite records judged')
      expect(text).toContain('stderr (tail):')
      expect(text).toContain('cite-check: skipped sources.json')

      // The JSON surface carries the same fields for machine readers.
      const json = makeIo(cwd)
      expect(await runWaypointCli(['tasks', 'show', 'task-w4-1', '--json'], json.io)).toBe(0)
      const parsed = JSON.parse(json.stdout.join('\n')) as { attempt: { failure_detail: string | null } }
      expect(parsed.attempt.failure_detail).toContain('deterministic step exited 2')
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('W4 lease loss: the losing bridge kills its attempt and writes NOTHING', async () => {
    const schema = freshSchema('waypoint_w4_lease')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      await seedRouteWithDispatches(pool, cwd, schema, 1)
      // The attempt holds until the bridge's lease-loss detection aborts it —
      // the same signal path the worker runtime uses to kill a process group.
      const runtime = {
        runRecipe: async (input: WaypointBridgeRecipeRuntimeInput) => {
          await new Promise<void>((resolve) => {
            if (input.signal?.aborted) return resolve()
            input.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          return { status: 'stopped' }
        },
      }

      // Steal the claim mid-attempt: what a reclaim + re-claim by another
      // bridge looks like from this bridge's point of view.
      const steal = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        await pool.query(`UPDATE "${schema}".dispatches SET claimed_by = 'thief-bridge', claimed_at = now() WHERE status = 'running'`)
      })()

      const result = await runWaypointBridge(cwd, { once: true, runtime, claimLeaseMs: 3_000 })
      await steal

      expect(result.processed).toHaveLength(1)
      expect(result.processed[0]!.outcome).toBe('stopped')
      expect(result.processed[0]!.engine_advanced).toBe(false)

      // The loser wrote nothing: the row still belongs to the thief, the
      // task was never recorded off-graph, and no bridge event was appended.
      const dispatch = await pool.query(`SELECT status, claimed_by, close_reason FROM "${schema}".dispatches`)
      expect(dispatch.rows[0]).toEqual({ status: 'running', claimed_by: 'thief-bridge', close_reason: null })
      const task = await pool.query(`SELECT status FROM "${schema}".tasks WHERE id = 'task-w4-1'`)
      expect(task.rows[0]).toEqual({ status: 'open' })
      const events = await pool.query(`SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind LIKE 'route.bridge.task.%'`)
      expect(events.rows[0]).toEqual({ n: 0 })
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- W5: acceptance — the full worker-host loop, config-driven ----------
  // No injected runtime: .waypoint/config.yaml selects `runtime.recipe: worker`,
  // the factory builds WorkerRecipeRuntime, the bridge spawns a FAKE AGENT
  // subprocess per dispatch, and the agent reports by writing its CLAIM FILE —
  // the one report seam on every path (rsc-452). The worker has no route to
  // Postgres (no WAYPOINT_POSTGRES_URL in its env, no `waypoint tasks report`); the
  // HOST reads the claim after exit and files the durable row. This exercises
  // the default file-claim report reader end to end. Requires `pnpm build`.

  it('W5 acceptance: a fake agent reporting via its claim file drives the quest to complete under runtime.recipe: worker', async () => {
    const schema = freshSchema('waypoint_w5')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // The fake agent: reads the work order from stdin, extracts the fenced
      // payload, and writes its claim to .waypoint/claims/<route>/<task>.json —
      // exactly the path and JSON shape the work order's report contract states.
      // It touches no CLI and no database: the file IS the report.
      const agentScript = join(cwd, 'fake-agent.mjs')
      const { writeFile, readFile } = await import('node:fs/promises')
      await writeFile(
        agentScript,
        `
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  const payload = JSON.parse(chunks.join('').match(/^Payload: (.+)$/m)[1])
  const claim = join(payload.project_root, '.waypoint', 'claims', payload.route_id, payload.task_id + '.json')
  await mkdir(dirname(claim), { recursive: true })
  // A review-bearing plan (rsc-8vw) demands an itemized verdict per declared
  // check — part of the report contract a compliant agent honors.
  const evidence = { probe: 'w5' }
  for (const check of payload.review_checks ?? []) {
    evidence['review.' + check] = 'pass:w5 fake agent confirmed ' + check
  }
  await writeFile(claim, JSON.stringify({
    task_id: payload.task_id,
    status: 'finished',
    summary: 'fake agent completed ' + payload.recipe_slug,
    evidence,
  }))
  process.exit(0)
})
`,
      )

      // Select the worker runtime in the project config — the same file an
      // operator would edit.
      const { parseWaypointProjectConfig, serializeWaypointProjectConfig } = await import('@waypoint-engine/folder-host')
      const configPath = join(cwd, '.waypoint', 'config.yaml')
      const config = parseWaypointProjectConfig(await readFile(configPath, 'utf8'))
      await writeFile(
        configPath,
        serializeWaypointProjectConfig({
          ...config,
          runtime: {
            recipe: 'worker',
            worker: { command: process.execPath, args: ['--no-use-system-ca', agentScript] },
          },
        }),
      )

      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion under the worker host',
        90_000,
      )

      // The agents' claims landed on the dispatch rows via the claim files the
      // host read after exit, and the host closed each attempt as finished.
      const dispatches = await pool.query(
        `SELECT status, close_reason, report->>'summary' AS summary, report->'evidence'->>'probe' AS probe
         FROM "${schema}".dispatches ORDER BY id`,
      )
      expect(dispatches.rows).toEqual([
        { status: 'completed', close_reason: 'finished', summary: 'fake agent completed runner-code-reviewer', probe: 'w5' },
        { status: 'completed', close_reason: 'finished', summary: 'fake agent completed runner-code-fixer', probe: 'w5' },
      ])

      // The engine recorded the outcome as task evidence: the host's payload
      // carries the agent's report (claim) inside the host-derived outcome.
      const tasks = await pool.query(
        `SELECT status, evidence->'report'->>'summary' AS claimed FROM "${schema}".tasks WHERE kind = 'recipe' ORDER BY plan_ref`,
      )
      expect(tasks.rows.every((row: { status: string }) => row.status === 'done')).toBe(true)
      expect((tasks.rows as Array<{ claimed: string | null }>).map((row) => row.claimed)).toEqual([
        'fake agent completed runner-code-fixer',
        'fake agent completed runner-code-reviewer',
      ])

      const route = await routeState(pool, schema)
      expect(route).toEqual({ status: 'complete', node: null })
    } finally {
      await pool.end()
    }
  }, 180_000)

  // ---- X1: parallel-join from waves (docs/designs/df-operator-coverage.md) --
  // A workspace-authored quest with a same-wave recipe pair compiles to a
  // real `&` join: the engine inserts BOTH dispatches before either outcome
  // signal (graph-level parallelism, not just host-side concurrency), the
  // W4 pool runs them, and the join releases the downstream chain.

  it('X1: a same-wave pair runs as a parallel join through the real engine', async () => {
    const schema = freshSchema('waypoint_x1')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
      await mkdir(join(cwd, '.waypoint', 'recipes'), { recursive: true })
      for (const slug of ['x1-recipe-a', 'x1-recipe-b']) {
        await writeFile(
          join(cwd, '.waypoint', 'recipes', slug + '.yaml'),
          'schema_version: 1\nslug: ' + slug + '\nname: ' + slug + '\nprompt: Do the branch work.\n',
        )
      }
      const plan = (ref: string, title: string, wave: number, recipe: string | null): string => [
        '                - plan_ref: ' + ref,
        '                  title: ' + title,
        '                  wave: ' + wave,
        '                  metadata:',
        '                    runner:',
        ...(recipe === null
          ? ['                      node:', '                        type: checkpoint']
          : ['                      recipe:', '                        slug: ' + recipe, '                      node:', '                        type: recipe']),
      ].join('\n')
      await writeFile(
        join(cwd, '.waypoint', 'quests', 'x1-parallel.yaml'),
        [
          'schema_version: 1',
          'slug: x1-parallel',
          'name: X1 parallel wave probe',
          'workflow: workflows/x1-parallel.md',
          'recipes:',
          '  - x1-recipe-a',
          '  - x1-recipe-b',
          'scaffolds:',
          '  workstreams:',
          '    - key: x1',
          '      name: X1',
          '      milestones:',
          '        - version_label: v1',
          '          title: X1 parallel',
          '          phases:',
          "            - phase_key: '10'",
          '              phase_slug: fanout',
          '              lifecycle_phase: fanout',
          '              plans:',
          plan('x1-prep', 'Prepare', 10, null),
          plan('x1-fan-a', 'Branch A', 20, 'x1-recipe-a'),
          plan('x1-fan-b', 'Branch B', 20, 'x1-recipe-b'),
          plan('x1-wrap', 'Wrap', 30, null),
          '',
        ].join('\n'),
      )
      expect(await runWaypointCli(['start', '--quest', 'x1-parallel'], silentIo(cwd))).toBe(0)

      // Graph-level parallelism: the engine executes BOTH branch dispatch
      // INSERTs up to their waits BEFORE any outcome signal exists. The
      // sequential compiler could never produce this state.
      const pending = await until(
        async () => (await pool.query(`SELECT task_ref, status FROM "${schema}".dispatches ORDER BY task_ref`)).rows,
        (rows) => (rows as Array<{ task_ref: string }>).length === 2,
        'both branch dispatches inserted before any signal',
      )
      expect(pending).toEqual([
        { task_ref: 'x1-fan-a', status: 'pending' },
        { task_ref: 'x1-fan-b', status: 'pending' },
      ])

      const runtime = new ScriptedRuntime((input) => ({ status: 'finished', summary: 'x1 ' + input.taskId }))
      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true, runtime, concurrency: 2 })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion past the parallel join',
        90_000,
      )

      const tasks = await pool.query(`SELECT plan_ref, status FROM "${schema}".tasks ORDER BY plan_ref`)
      expect((tasks.rows as Array<{ status: string }>).every((row) => row.status === 'done')).toBe(true)
      // No event-id collision under the join: the old count-derived ids would
      // have tripped UNIQUE(route_id, id) and failed the instance.
      const events = await pool.query(`SELECT id FROM "${schema}".route_events`)
      expect(new Set((events.rows as Array<{ id: string }>).map((row) => row.id)).size).toBe(events.rows.length)
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- X2: when predicate → df.if (docs/designs/df-operator-coverage.md) ---
  // A workspace-authored quest with two guarded recipe plans: one predicate
  // holds (the plan dispatches and runs), one is falsy (the plan is recorded
  // done with {skipped: true} evidence plus a route.task.skipped event and is
  // NEVER dispatched), and the chain continues to completion either way.

  function writeWhenQuest(cwd: string, schema: string, predicates: { always: string; never: string }): Promise<void> {
    const plan = (ref: string, title: string, wave: number, recipe: string | null, when?: string): string =>
      [
        '                - plan_ref: ' + ref,
        '                  title: ' + title,
        '                  wave: ' + wave,
        '                  metadata:',
        '                    runner:',
        ...(when === undefined ? [] : ['                      when: ' + when]),
        ...(recipe === null
          ? ['                      node:', '                        type: checkpoint']
          : ['                      recipe:', '                        slug: ' + recipe, '                      node:', '                        type: recipe']),
      ].join('\n')
    return (async () => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
      await mkdir(join(cwd, '.waypoint', 'recipes'), { recursive: true })
      for (const slug of ['x2-recipe-run', 'x2-recipe-skip']) {
        await writeFile(
          join(cwd, '.waypoint', 'recipes', slug + '.yaml'),
          'schema_version: 1\nslug: ' + slug + '\nname: ' + slug + '\nprompt: Do the guarded work.\n',
        )
      }
      await writeFile(
        join(cwd, '.waypoint', 'quests', 'x2-when.yaml'),
        [
          'schema_version: 1',
          'slug: x2-when',
          'name: X2 when predicate probe',
          'workflow: workflows/x2-when.md',
          'recipes:',
          '  - x2-recipe-run',
          '  - x2-recipe-skip',
          'scaffolds:',
          '  workstreams:',
          '    - key: x2',
          '      name: X2',
          '      milestones:',
          '        - version_label: v1',
          '          title: X2 when',
          '          phases:',
          "            - phase_key: '10'",
          '              phase_slug: guard',
          '              lifecycle_phase: guard',
          '              plans:',
          plan('x2-prep', 'Prepare', 10, null),
          plan('x2-always', 'Guarded, predicate holds', 20, 'x2-recipe-run', predicates.always),
          plan('x2-never', 'Guarded, predicate falsy', 25, 'x2-recipe-skip', predicates.never),
          plan('x2-wrap', 'Wrap', 30, null),
          '',
        ].join('\n'),
      )
    })()
  }

  it('X2: when predicates decide through the real engine — truthy runs, falsy skips with evidence', async () => {
    const schema = freshSchema('waypoint_x2')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // Real predicates over real state, evaluated by the engine at the
      // df.if node: prep's task row exists; 'no-such-plan' never will.
      await writeWhenQuest(cwd, schema, {
        always: `SELECT EXISTS (SELECT 1 FROM ${schema}.tasks WHERE plan_ref = 'x2-prep')`,
        never: `SELECT EXISTS (SELECT 1 FROM ${schema}.tasks WHERE plan_ref = 'no-such-plan')`,
      })
      expect(await runWaypointCli(['start', '--quest', 'x2-when'], silentIo(cwd))).toBe(0)

      const runtime = new ScriptedRuntime((input) => ({ status: 'finished', summary: 'x2 ' + input.taskId }))
      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true, runtime })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion past both when guards',
        90_000,
      )

      // The falsy plan was NEVER dispatched — the guard sits above the
      // dispatch INSERT, not in front of the worker.
      const dispatches = await pool.query(`SELECT task_ref FROM "${schema}".dispatches ORDER BY task_ref`)
      expect(dispatches.rows).toEqual([{ task_ref: 'x2-always' }])

      // Every task is done; the skipped one carries {skipped: true} evidence
      // with the predicate on record.
      const tasks = await pool.query(
        `SELECT plan_ref, status, evidence->>'skipped' AS skipped FROM "${schema}".tasks ORDER BY plan_ref`,
      )
      expect(tasks.rows).toEqual([
        { plan_ref: 'x2-always', status: 'done', skipped: null },
        { plan_ref: 'x2-never', status: 'done', skipped: 'true' },
        { plan_ref: 'x2-prep', status: 'done', skipped: null },
        { plan_ref: 'x2-wrap', status: 'done', skipped: null },
      ])
      const skippedEvidence = await pool.query(
        `SELECT evidence->>'when' AS predicate FROM "${schema}".tasks WHERE plan_ref = 'x2-never'`,
      )
      expect(skippedEvidence.rows[0]!.predicate).toContain("plan_ref = 'no-such-plan'")

      // The skip is visible in the record: exactly one route.task.skipped
      // event, naming the skipped plan.
      const skipped = await pool.query(
        `SELECT payload->>'plan_ref' AS plan_ref FROM "${schema}".route_events WHERE kind = 'route.task.skipped'`,
      )
      expect(skipped.rows).toEqual([{ plan_ref: 'x2-never' }])
      const events = await pool.query(`SELECT id FROM "${schema}".route_events`)
      expect(new Set((events.rows as Array<{ id: string }>).map((row) => row.id)).size).toBe(events.rows.length)
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('X2 fail closed: a predicate that cannot parse against the database never starts a route', async () => {
    const schema = freshSchema('waypoint_x2bad')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // Passes every static rule, fails Postgres analysis: the column does
      // not exist. The PREPARE probe must stop df.start.
      await writeWhenQuest(cwd, schema, {
        always: `SELECT no_such_column FROM ${schema}.tasks`,
        never: `SELECT EXISTS (SELECT 1 FROM ${schema}.tasks WHERE plan_ref = 'no-such-plan')`,
      })
      const io = makeIo(cwd)
      expect(await runWaypointCli(['start', '--quest', 'x2-when'], io.io)).toBe(1)
      expect(io.stderr.join('\n')).toContain('does not parse against the database')

      // No engine instance was registered and nothing was dispatched.
      const routes = await pool.query(`SELECT count(*)::int AS started FROM "${schema}".routes WHERE instance_id IS NOT NULL`)
      expect(routes.rows[0]).toEqual({ started: 0 })
      const dispatches = await pool.query(`SELECT count(*)::int AS n FROM "${schema}".dispatches`)
      expect(dispatches.rows[0]).toEqual({ n: 0 })
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- X3: deadline waits → df.race (docs/designs/df-operator-coverage.md) --
  // A wait with days + landmark parks on BOTH exits: the landmark signal
  // (sent by `waypoint resume --resolve-blocker`, the same command that
  // resolves waits on the folder backend) races the clock, and the
  // record states which arm won.

  async function writeWaitQuest(cwd: string, days: number): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
    await writeFile(
      join(cwd, '.waypoint', 'quests', 'x3-wait.yaml'),
      [
        'schema_version: 1',
        'slug: x3-wait',
        'name: X3 deadline wait probe',
        'workflow: workflows/x3-wait.md',
        'recipes: []',
        'scaffolds:',
        '  workstreams:',
        '    - key: x3',
        '      name: X3',
        '      milestones:',
        '        - version_label: v1',
        '          title: X3 wait',
        '          phases:',
        "            - phase_key: '10'",
        '              phase_slug: clock',
        '              lifecycle_phase: clock',
        '              plans:',
        '                - plan_ref: x3-prep',
        '                  title: Prepare',
        '                  wave: 10',
        '                  metadata:',
        '                    runner:',
        '                      node:',
        '                        type: checkpoint',
        '                - plan_ref: x3-window',
        '                  title: Wait for the response or the clock',
        '                  wave: 20',
        '                  metadata:',
        '                    runner:',
        '                      wait:',
        '                        kind: duration_or_landmark',
        '                        landmark: response_received',
        `                        days: ${days}`,
        '                      node:',
        '                        type: wait',
        '                - plan_ref: x3-wrap',
        '                  title: Wrap',
        '                  wave: 30',
        '                  metadata:',
        '                    runner:',
        '                      node:',
        '                        type: checkpoint',
        '',
      ].join('\n'),
    )
  }

  it('X3 resolved: the landmark signal beats the clock via waypoint resume --resolve-blocker', async () => {
    const schema = freshSchema('waypoint_x3res')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      await writeWaitQuest(cwd, 7) // a real seven-day window — only the signal can end it in test time
      expect(await runWaypointCli(['start', '--quest', 'x3-wait'], silentIo(cwd))).toBe(0)

      // The route parks visibly at the wait: route blocked, task blocked.
      await until(
        async () => (await pool.query(`SELECT status, current_node FROM "${schema}".routes`)).rows[0],
        (row) => (row as { status: string; current_node: string | null }).status === 'blocked' && (row as { current_node: string | null }).current_node === 'x3-window',
        'route parked at the deadline wait',
      )

      const routeId = ((await pool.query(`SELECT id FROM "${schema}".routes`)).rows[0] as { id: string }).id
      const io = makeIo(cwd)
      const resolveCode = await runWaypointCli(['resume', '--route-id', routeId, '--resolve-blocker', '--note', 'response received'], io.io)
      expect(resolveCode, io.stderr.join('\n')).toBe(0)
      expect(io.stdout.join('\n')).toContain('Resolved blocker')

      await until(async () => routeState(pool, schema), (route) => route.status === 'complete', 'route completion past the resolved wait')

      // The record says WHY: resolved, with the operator's note as evidence.
      const task = await pool.query(
        `SELECT status, evidence->>'observed' AS observed, evidence->>'note' AS note FROM "${schema}".tasks WHERE plan_ref = 'x3-window'`,
      )
      expect(task.rows[0]).toEqual({ status: 'done', observed: 'true', note: 'response received' })
      const kinds = await pool.query(`SELECT kind FROM "${schema}".route_events WHERE kind LIKE 'task.wait.%'`)
      expect(kinds.rows).toEqual([{ kind: 'task.wait.resolved' }])
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('X3 elapsed: the clock arm wins when no landmark is observed', async () => {
    const schema = freshSchema('waypoint_x3elap')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const days = 0.0001 // 8.64 seconds
      await writeWaitQuest(cwd, days)
      const startIo = makeIo(cwd)
      const startCode = await runWaypointCli(['start', '--quest', 'x3-wait'], startIo.io)
      expect(startCode, startIo.stderr.join('\n')).toBe(0)

      // Nothing signals; the sleep arm wins and the route completes alone.
      await until(async () => routeState(pool, schema), (route) => route.status === 'complete', 'route completion past the elapsed wait', 60_000)

      const task = await pool.query(
        `SELECT status, evidence->>'elapsed' AS elapsed, evidence->>'days' AS days FROM "${schema}".tasks WHERE plan_ref = 'x3-window'`,
      )
      expect(task.rows[0]).toEqual({ status: 'done', elapsed: 'true', days: String(days) })
      const kinds = await pool.query(`SELECT kind FROM "${schema}".route_events WHERE kind LIKE 'task.wait.%'`)
      expect(kinds.rows).toEqual([{ kind: 'task.wait.elapsed' }])
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- X4: guardrailed repeat loops (docs/designs/df-operator-coverage.md) --
  // A quest-level `repeat` wraps the whole graph in `@> (...)`: each pass
  // re-runs the checkpoint body, appends a runtime-id tick event, and parks
  // on the interval sleep. The route never completes — it runs until
  // cancelled.

  it('X4: a repeating quest loops through the real engine — ticks accumulate, the route never completes', async () => {
    const schema = freshSchema('waypoint_x4')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
      await writeFile(
        join(cwd, '.waypoint', 'quests', 'x4-repeat.yaml'),
        [
          'schema_version: 1',
          'slug: x4-repeat',
          'name: X4 repeat probe',
          'workflow: workflows/x4-repeat.md',
          'repeat:',
          '  every_days: 0.00003', // ~3 seconds per pass
          'recipes: []',
          'scaffolds:',
          '  workstreams:',
          '    - key: x4',
          '      name: X4',
          '      milestones:',
          '        - version_label: v1',
          '          title: X4 repeat',
          '          phases:',
          "            - phase_key: '10'",
          '              phase_slug: maintain',
          '              lifecycle_phase: maintain',
          '              plans:',
          '                - plan_ref: x4-beat',
          '                  title: Heartbeat sweep',
          '                  wave: 10',
          '                  metadata:',
          '                    runner:',
          '                      node:',
          '                        type: checkpoint',
          '',
        ].join('\n'),
      )
      expect(await runWaypointCli(['start', '--quest', 'x4-repeat'], silentIo(cwd))).toBe(0)

      // Two full passes: the tick event is the per-iteration record (the
      // checkpoint's own event dedupes to one across iterations by design).
      const ticks = await until(
        async () => (await pool.query(`SELECT id FROM "${schema}".route_events WHERE kind = 'route.repeat.tick' ORDER BY ord`)).rows,
        (rows) => (rows as Array<{ id: string }>).length >= 2,
        'two repeat ticks',
        90_000,
      )
      const ids = (ticks as Array<{ id: string }>).map((row) => row.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^event-r\d+$/)

      // The route is alive, not complete; the body ran; the checkpoint's
      // engine event deduped to exactly one across iterations.
      const route = await routeState(pool, schema)
      expect(route.status).toBe('active')
      const task = await pool.query(`SELECT status FROM "${schema}".tasks WHERE plan_ref = 'x4-beat'`)
      expect(task.rows[0]).toEqual({ status: 'done' })
      const done = await pool.query(`SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind = 'task.done'`)
      expect(done.rows[0]).toEqual({ n: 1 })
    } finally {
      // A repeating instance runs until cancelled — stop it before the
      // schema drops out from under it.
      try {
        const instance = await pool.query(`SELECT instance_id FROM "${schema}".routes`)
        const instanceId = (instance.rows[0] as { instance_id: string | null } | undefined)?.instance_id
        if (instanceId) await pool.query('SELECT df.cancel($1, $2)', [instanceId, 'x4 e2e cleanup'])
      } catch {
        // cleanup only
      }
      await pool.end()
    }
  }, 120_000)

  // ---- X5: start-time variables (docs/designs/df-operator-coverage.md) -----
  // df.setvar rides the df.start connection; the engine substitutes
  // {waypoint_schema}/{waypoint_route_id}/{waypoint_quest}/{waypoint_subject_*} wherever
  // they appear in node SQL. The authored YAML below carries NO hardcoded
  // schema or route id — the predicates are portable, which is the point.

  it('X5: predicates reference start-time variables — the engine resolves them from the setvar snapshot', async () => {
    const schema = freshSchema('waypoint_x5')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      await writeWhenQuest(cwd, schema, {
        always: "SELECT EXISTS (SELECT 1 FROM {waypoint_schema}.tasks WHERE route_id = '{waypoint_route_id}' AND plan_ref = 'x2-prep')",
        never: "SELECT '{waypoint_quest}' = 'some-other-quest'",
      })
      expect(await runWaypointCli(['start', '--quest', 'x2-when'], silentIo(cwd))).toBe(0)

      const runtime = new ScriptedRuntime((input) => ({ status: 'finished', summary: 'x5 ' + input.taskId }))
      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true, runtime })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion past variable-bearing guards',
        90_000,
      )

      // The variable-true guard dispatched and ran; the variable-false guard
      // never dispatched and recorded the skip with the AUTHORED (verbatim,
      // unsubstituted) predicate as evidence.
      const dispatches = await pool.query(`SELECT task_ref FROM "${schema}".dispatches ORDER BY task_ref`)
      expect(dispatches.rows).toEqual([{ task_ref: 'x2-always' }])
      const skipped = await pool.query(
        `SELECT status, evidence->>'skipped' AS skipped FROM "${schema}".tasks WHERE plan_ref = 'x2-never'`,
      )
      expect(skipped.rows[0]).toEqual({ status: 'done', skipped: 'true' })
    } finally {
      await pool.end()
    }
  }, 120_000)

  // ---- X6 acceptance (docs/designs/df-operator-coverage.md) ----------------
  // The full authoring path: quests AUTHORED IN PROSE, compiled by the real
  // tools/prose/compile.py, exercising every reachable operator — sequence,
  // capture, parallel-join (X1), machine conditional + start-time variables
  // (X2/X5), deadline race (X3), gate — driven green through the real engine
  // by the real CLI. The repeat loop (X4) gets its own quest below (a
  // repeating quest excludes recipes/gates/waits by design).

  const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

  async function compileProse(cwd: string, proseName: string, yamlName: string): Promise<void> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('python3', [
      join(REPO_ROOT, 'tools', 'prose', 'compile.py'),
      join(cwd, proseName),
      '-o',
      join(cwd, '.waypoint', 'quests', yamlName),
    ])
  }

  it('X6 acceptance: a prose-authored quest exercising every operator runs green end to end', async () => {
    const schema = freshSchema('waypoint_x6')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
      await mkdir(join(cwd, '.waypoint', 'recipes'), { recursive: true })
      for (const slug of ['x6-recipe-a', 'x6-recipe-b']) {
        await writeFile(
          join(cwd, '.waypoint', 'recipes', slug + '.yaml'),
          'schema_version: 1\nslug: ' + slug + '\nname: ' + slug + '\nprompt: Do the branch work.\n',
        )
      }
      await writeFile(
        join(cwd, 'x6-full.prose'),
        [
          '# X6 Full Vocabulary Probe',
          'one quest exercising every reachable operator.',
          '',
          '## Catalog details',
          'Slug: x6-full',
          '',
          '## Ground rules',
          '- Source files are read-only.',
          '',
          '## Recipes used',
          '- x6-recipe-a',
          '- x6-recipe-b',
          '',
          '## Milestone v1: Full vocabulary',
          '',
          '## Phase: Prepare (execute)',
          '- Prepare the inputs (ref: x6-prep)',
          '',
          '## Phase: Fan out (execute)',
          '- Branch A of the fan-out (ref: x6-fan-a)',
          '  Uses recipe: x6-recipe-a',
          '  Wave: 20',
          '- Branch B of the fan-out (ref: x6-fan-b)',
          '  Uses recipe: x6-recipe-b',
          '  Wave: 20',
          '- Skip this unless the quest is misnamed (ref: x6-never)',
          "  When (SQL): SELECT '{waypoint_quest}' = 'not-this-quest'",
          '  Wave: 30',
          '- Confirm prep is on the record before proceeding (ref: x6-maybe)',
          "  When (SQL): SELECT EXISTS (SELECT 1 FROM {waypoint_schema}.tasks WHERE route_id = '{waypoint_route_id}' AND plan_ref = 'x6-prep' AND status = 'done')",
          '  Wave: 40',
          '',
          '## Phase: Window (verify)',
          '- Wait: Wait for the response or the seven-day clock (ref: x6-window)',
          '  Kind: duration_or_landmark',
          '  Days: 7',
          '  Landmark: response_received',
          '',
          '## Phase: Ship (ship)',
          '- Gate: Approve the assembled result for shipping (ref: x6-ship-gate)',
          '  Kind: approval',
          '  Wave: 10',
          '- Wrap up and record completion (ref: x6-wrap)',
          '  Wave: 20',
          '',
        ].join('\n'),
      )
      await compileProse(cwd, 'x6-full.prose', 'x6-full.yaml')
      expect(await runWaypointCli(['start', '--quest', 'x6-full'], silentIo(cwd))).toBe(0)

      // X1 through the prose path: both branch dispatches pending before any
      // outcome signal.
      const pending = await until(
        async () => (await pool.query(`SELECT task_ref, status FROM "${schema}".dispatches ORDER BY task_ref`)).rows,
        (rows) => (rows as Array<{ task_ref: string }>).length === 2,
        'both fan-out dispatches inserted',
      )
      expect(pending).toEqual([
        { task_ref: 'x6-fan-a', status: 'pending' },
        { task_ref: 'x6-fan-b', status: 'pending' },
      ])

      // Drive the branches; the route then parks at the deadline wait.
      const runtime = new ScriptedRuntime((input) => ({ status: 'finished', summary: 'x6 ' + input.taskId }))
      await until(
        async () => {
          const result = await runWaypointBridge(cwd, { once: true, runtime, concurrency: 2 })
          for (const item of result.processed) expect(item.engine_advanced, `${item.task_ref} signal consumed`).toBe(true)
          return await routeState(pool, schema)
        },
        (route) => route.status === 'blocked' && route.node === 'x6-window',
        'route parked at the deadline wait',
        90_000,
      )

      // X2/X5 through the prose path: the variable-false guard skipped with
      // evidence, the variable-true guard passed.
      const guards = await pool.query(
        `SELECT plan_ref, status, evidence->>'skipped' AS skipped FROM "${schema}".tasks WHERE plan_ref IN ('x6-never', 'x6-maybe') ORDER BY plan_ref`,
      )
      expect(guards.rows).toEqual([
        { plan_ref: 'x6-maybe', status: 'done', skipped: null },
        { plan_ref: 'x6-never', status: 'done', skipped: 'true' },
      ])

      // X3: resolve the seven-day window early via the CLI.
      const routeId = ((await pool.query(`SELECT id FROM "${schema}".routes`)).rows[0] as { id: string }).id
      const resolveIo = makeIo(cwd)
      const resolveCode = await runWaypointCli(['resume', '--route-id', routeId, '--resolve-blocker', '--note', 'response received'], resolveIo.io)
      expect(resolveCode, resolveIo.stderr.join('\n')).toBe(0)

      // Gate: park, then approve via the CLI.
      await until(async () => routeState(pool, schema), (route) => route.status === 'blocked' && route.node === 'x6-ship-gate', 'route parked at the gate', 90_000)
      expect(await runWaypointCli(['gate', '--route-id', routeId, '--node', 'x6-ship-gate', '--approve'], silentIo(cwd))).toBe(0)

      await until(async () => routeState(pool, schema), (route) => route.status === 'complete', 'route completion', 90_000)

      // The record: every task done, the skip visible, the wait resolved (not
      // elapsed), the gate approved, exactly the two authored dispatches.
      const tasks = await pool.query(`SELECT count(*)::int AS open FROM "${schema}".tasks WHERE status <> 'done'`)
      expect(tasks.rows[0]).toEqual({ open: 0 })
      const kinds = await pool.query(
        `SELECT kind, count(*)::int AS n FROM "${schema}".route_events WHERE kind IN ('route.task.skipped', 'task.wait.resolved', 'task.wait.elapsed', 'route.gate.approved') GROUP BY kind ORDER BY kind`,
      )
      expect(kinds.rows).toEqual([
        { kind: 'route.gate.approved', n: 1 },
        { kind: 'route.task.skipped', n: 1 },
        { kind: 'task.wait.resolved', n: 1 },
      ])
      const dispatches = await pool.query(`SELECT count(*)::int AS n FROM "${schema}".dispatches`)
      expect(dispatches.rows[0]).toEqual({ n: 2 })
    } finally {
      await pool.end()
    }
  }, 180_000)

  it('tier report (rsc-b5b): waypoint tier-report aggregates dispatch outcomes per recipe from the durable store', async () => {
    const schema = freshSchema('waypoint_tierreport')
    const cwd = await initDurableProject(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const runtime = new ScriptedRuntime(() => ({ status: 'finished', summary: 'tier e2e evidence' }))
      await until(
        async () => {
          await runWaypointBridge(cwd, { once: true, runtime })
          return await routeState(pool, schema)
        },
        (route) => route.status === 'complete',
        'route completion',
        90_000,
      )

      const report = makeIo(cwd)
      expect(await runWaypointCli(['tier-report', '--json'], report.io), report.stderr.join('\n')).toBe(0)
      const parsed = JSON.parse(report.stdout.join('\n')) as {
        recipes: Array<{
          recipe: string
          model_class: string
          dispatches: number
          outcomes: { finished: number; failed: number; exhausted: number; stopped: number; open: number }
          avg_queue_seconds: number | null
          avg_work_seconds: number | null
          last_summary: string | null
        }>
      }
      expect(parsed.recipes.map((row) => row.recipe)).toEqual(['runner-code-fixer', 'runner-code-reviewer'])
      for (const row of parsed.recipes) {
        expect(row.dispatches).toBe(1)
        expect(row.outcomes).toEqual({ finished: 1, failed: 0, exhausted: 0, stopped: 0, open: 0 })
        expect(row.model_class).toBe('untagged')
        expect(row.avg_queue_seconds).not.toBeNull()
        expect(row.avg_work_seconds).not.toBeNull()
        // last_summary reads the W1 report row — the agent's own claim. A
        // scripted runtime files no report, so null is the truthful value
        // (the worker host path populates it from the agent's claim file).
        expect(row.last_summary).toBeNull()
      }

      // The human-readable form carries the same rows.
      const plain = makeIo(cwd)
      expect(await runWaypointCli(['tier-report'], plain.io)).toBe(0)
      expect(plain.stdout.join('\n')).toContain('runner-code-reviewer | untagged | 1 | 1/0/0/0/0')
    } finally {
      await pool.end()
    }
  }, 120_000)

  it('X6 acceptance: a prose-authored repeating quest ticks and is ended by waypoint route cancel', async () => {
    const schema = freshSchema('waypoint_x6rep')
    const cwd = await initDurableProjectNoStart(schema)
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
      await writeFile(
        join(cwd, 'x6-repeat.prose'),
        [
          '# X6 Repeat Probe',
          'maintenance heartbeat probe.',
          '',
          '## Catalog details',
          'Slug: x6-repeat',
          'Repeat: every 0.00003 days',
          '',
          '## Ground rules',
          '- Source files are read-only.',
          '',
          '## Milestone v1: Heartbeat',
          '',
          '## Phase: Maintain (execute)',
          '- Sweep the workspace (ref: x6-beat)',
          '',
        ].join('\n'),
      )
      await compileProse(cwd, 'x6-repeat.prose', 'x6-repeat.yaml')
      expect(await runWaypointCli(['start', '--quest', 'x6-repeat'], silentIo(cwd))).toBe(0)

      await until(
        async () => (await pool.query(`SELECT count(*)::int AS n FROM "${schema}".route_events WHERE kind = 'route.repeat.tick'`)).rows[0],
        (row) => (row as { n: number }).n >= 2,
        'two repeat ticks',
        90_000,
      )

      // The X4 gap closed: the CLI ends the repeating route — engine instance
      // cancelled, route row cancelled, event on the record.
      const routeId = ((await pool.query(`SELECT id, instance_id FROM "${schema}".routes`)).rows[0] as { id: string; instance_id: string }).id
      const io = makeIo(cwd)
      expect(await runWaypointCli(['route', 'cancel', '--route-id', routeId, '--reason', 'x6 acceptance done'], io.io)).toBe(0)
      expect(io.stdout.join('\n')).toContain(`Cancelled run ${routeId}`)

      const route = await pool.query(`SELECT status, instance_id FROM "${schema}".routes`)
      expect((route.rows[0] as { status: string }).status).toBe('cancelled')
      const engine = await pool.query('SELECT df.status($1) AS status', [(route.rows[0] as { instance_id: string }).instance_id])
      expect(engine.rows[0]).toEqual({ status: 'cancelled' })
      const event = await pool.query(`SELECT payload->>'reason' AS reason FROM "${schema}".route_events WHERE kind = 'route.cancelled'`)
      expect(event.rows).toEqual([{ reason: 'x6 acceptance done' }])

      // Cancelling twice refuses.
      const second = makeIo(cwd)
      expect(await runWaypointCli(['route', 'cancel', '--route-id', routeId], second.io)).toBe(1)
      expect(second.stderr.join('\n')).toContain('already cancelled')
    } finally {
      await pool.end()
    }
  }, 120_000)
})

describe('waypoint bridge flag validation', () => {
  it('rejects a non-positive --concurrency before touching any backend', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'bridge-flags-'))
    const io = makeIo(cwd)
    expect(await runWaypointCli(['bridge', '--once', '--concurrency', '0'], io.io)).toBe(1)
    expect(io.stderr.join('\n')).toContain('--concurrency takes a positive integer')
  })
})
