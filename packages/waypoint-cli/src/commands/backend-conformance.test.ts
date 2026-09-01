import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import pg from 'pg'

import { cancelSchemaDurableInstances } from '@waypoint-engine/folder-host'

import { runWaypointCli } from '../bin'
import { makeIo, requireTestPostgresUrl, silentIo } from '../testing/backend-harness'
import { requireTestPgDurableUrl } from '../../../waypoint-folder-host/src/testing/postgres.ts'

/**
 * Route-backend conformance suite.
 *
 * Postgres is the only route backend since P5 (the folder backend retired
 * behind this suite, as beads did before it — rsc-svg). What remains under
 * conformance is the execution-mode split on ONE storage substrate: plain
 * postgres driven by `waypoint auto` versus the pg_durable engine driving the
 * route. The suite runs ONE scenario — the bundled `runner` quest, 12 tasks
 * with 3 human approval gates — through the public CLI in both modes and
 * asserts the observable state machine is identical. Anything mode-specific
 * (dispatch mechanics, event synthesis) is excluded from the projection;
 * anything in the projection IS the contract both modes must honor.
 *
 * Modes exercised:
 * - postgres          — REQUIRED. The suite fails loud (not skip) without
 *                       WAYPOINT_POSTGRES_TEST_URL: with the folder backend
 *                       retired there is no zero-infra reference left, and a
 *                       green run must never silently shrink
 *                       (deploy/postgres provisions the local instance).
 * - postgres+durable  — REQUIRED too, since Phase 0 item 10. The engine drives
 *                       the route, so the scenario loop runs `waypoint bridge
 *                       --once` instead of `waypoint auto` (which durable routes
 *                       refuse by design) and synthesizes the equivalent
 *                       park/complete outcomes. This arm used to depend on a
 *                       raw WAYPOINT_PGDURABLE_TEST_URL read and dropped out on
 *                       every ordinary checkout, leaving `projections.length
 *                       >= 1` to pass with a single backend — a conformance
 *                       matrix of one. The Console instance carries pg_durable,
 *                       so it defaults there and fails loud if it is absent.
 *
 * There are no known divergences: every projection must deep-equal the plain
 * postgres reference with no carve-outs. The approved-gate task status is
 * lineage-derived 'done' in both modes (the contract fix adopted from beads
 * before it exited).
 */

const POSTGRES_URL = requireTestPostgresUrl()
// Phase 0, item 10: was a raw env read, so the durable arm of the conformance
// matrix silently dropped out on every ordinary checkout while the run still
// asserted `projections.length >= 1` — one backend passing read as a matrix.
const PGDURABLE_URL = requireTestPgDurableUrl()
const PG_SCHEMA = `waypoint_conformance_${process.pid}_${Math.floor(Math.random() * 1e6)}`
const PG_PIN_SCHEMA = `waypoint_conformance_pin_${process.pid}_${Math.floor(Math.random() * 1e6)}`
const PGDURABLE_SCHEMA = `waypoint_conformance_df_${process.pid}_${Math.floor(Math.random() * 1e6)}`

interface AutoOutcome {
  readonly status: string
  readonly blockedNode: string | null
}

interface BackendProjection {
  readonly backend: string
  /** plan_ref/kind graph materialized at start, in execution order. */
  readonly taskGraph: Array<{ plan_ref: string; kind: string }>
  /** Outcome of every `waypoint auto` invocation, in order. */
  readonly autoOutcomes: AutoOutcome[]
  /** Gate nodes approved, in order. */
  readonly gateDecisions: string[]
  readonly finalRoute: { status: string; current_node: string | null }
  /** plan_ref -> terminal task status. */
  readonly finalTaskStatuses: Record<string, string>
  /** route.gate.approved occurrences in the route-events surface. */
  readonly gateApprovedEvents: number
}

/**
 * Advance an engine-driven (durable) route one round: drain dispatches with
 * `waypoint bridge --once` and poll the route until the engine parks it at a
 * gate or completes it. Returns the same outcome shape `waypoint auto` reports,
 * so the durable column projects onto the identical contract.
 *
 * Stale-read guard (executed finding): right after an approve the route row
 * still reads blocked at the decided gate for a moment (the engine's
 * route-active update runs two nodes after the wait) — a park at an
 * already-decided gate is the engine mid-advance, not a new gate.
 */
async function driveDurableRound(cwd: string, backend: string, decided: ReadonlySet<string>): Promise<AutoOutcome> {
  const deadline = Date.now() + 90_000
  for (;;) {
    const bridge = makeIo(cwd)
    expect(await runWaypointCli(['bridge', '--once', '--json'], bridge.io), `${backend}: bridge failed: ${bridge.stderr.join('\n')}`).toBe(0)
    const route = makeIo(cwd)
    expect(await runWaypointCli(['route', '--route-id', 'route-001', '--json'], route.io)).toBe(0)
    const parsed = JSON.parse(route.stdout.join('\n')) as { route: { status: string; current_node: string | null } }
    if (parsed.route.status === 'complete') return { status: 'complete', blockedNode: null }
    if (parsed.route.status === 'blocked' && parsed.route.current_node !== null && !decided.has(parsed.route.current_node)) {
      return { status: 'blocked', blockedNode: parsed.route.current_node }
    }
    if (Date.now() > deadline) throw new Error(`${backend}: route neither parked nor completed; last: ${JSON.stringify(parsed.route)}`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

async function runScenario(backend: string, initArgs: string[], drive: 'auto' | 'bridge' = 'auto'): Promise<BackendProjection> {
  const cwd = await mkdtemp(join(tmpdir(), `conformance-${backend.replaceAll(/[^a-z0-9]/gi, '-')}-`))

  const init = makeIo(cwd)
  expect(await runWaypointCli(['init', '--quest', 'runner', '--simulated', ...initArgs], init.io), `${backend}: init failed: ${init.stderr.join('\n')}`).toBe(0)
  expect(await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd)), `${backend}: start failed`).toBe(0)

  const tasks = makeIo(cwd)
  expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasks.io)).toBe(0)
  const taskGraph = (JSON.parse(tasks.stdout.join('\n')) as { tasks: Array<{ plan_ref: string; kind: string }> }).tasks
    .map((task) => ({ plan_ref: task.plan_ref, kind: task.kind }))

  const autoOutcomes: AutoOutcome[] = []
  const gateDecisions: string[] = []
  for (let round = 0; round < 8; round += 1) {
    let outcome: AutoOutcome
    if (drive === 'bridge') {
      outcome = await driveDurableRound(cwd, backend, new Set(gateDecisions))
    } else {
      const auto = makeIo(cwd)
      expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '10', '--json'], auto.io)).toBe(0)
      const parsed = JSON.parse(auto.stdout.join('\n')) as { status: string; blockedNode?: string | null }
      outcome = { status: parsed.status, blockedNode: parsed.blockedNode ?? null }
    }
    autoOutcomes.push(outcome)
    if (outcome.status === 'complete') break
    if (outcome.status !== 'blocked' || !outcome.blockedNode) break
    const gate = makeIo(cwd)
    expect(
      await runWaypointCli(['gate', '--route-id', 'route-001', '--node', outcome.blockedNode, '--approve', '--note', 'conformance approve'], gate.io),
      `${backend}: gate approve failed at ${outcome.blockedNode}: ${gate.stderr.join('\n')}`,
    ).toBe(0)
    gateDecisions.push(outcome.blockedNode)
  }

  const route = makeIo(cwd)
  expect(await runWaypointCli(['route', '--route-id', 'route-001', '--json'], route.io)).toBe(0)
  const routeJson = JSON.parse(route.stdout.join('\n')) as { route: { status: string; current_node: string | null } }

  const finalTasks = makeIo(cwd)
  expect(await runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], finalTasks.io)).toBe(0)
  const finalTaskStatuses = Object.fromEntries(
    (JSON.parse(finalTasks.stdout.join('\n')) as { tasks: Array<{ plan_ref: string; status: string }> }).tasks
      .map((task) => [task.plan_ref, task.status]),
  )

  const events = makeIo(cwd)
  expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--limit', '100', '--json'], events.io)).toBe(0)
  const gateApprovedEvents = (JSON.parse(events.stdout.join('\n')) as { items: Array<{ kind: string }> }).items
    .filter((event) => event.kind === 'route.gate.approved').length

  return {
    backend,
    taskGraph,
    autoOutcomes,
    gateDecisions,
    finalRoute: { status: routeJson.route.status, current_node: routeJson.route.current_node },
    finalTaskStatuses,
    gateApprovedEvents,
  }
}

/** The backend name is the only field allowed to differ. */
function conformanceCore(projection: BackendProjection): Omit<BackendProjection, 'backend'> {
  const { backend: _backend, ...rest } = projection
  return rest
}

describe('route backend conformance (postgres vs postgres+durable)', () => {
  // A1: a durable start writes the bridge registry — sandbox the config home
  // or the OPERATOR'S Console spawns real bridges for these temp projects
  // (whose first-touch ensureSchema then resurrects the dropped schemas —
  // observed in vivo 2026-07-13).
  let savedConfigHome: string | undefined
  beforeAll(() => {
    savedConfigHome = process.env.WAYPOINT_CONFIG_HOME
    process.env.WAYPOINT_CONFIG_HOME = realpathSync(mkdtempSync(join(tmpdir(), 'waypoint-config-home-')))
  })

  afterAll(async () => {
    if (savedConfigHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
    else process.env.WAYPOINT_CONFIG_HOME = savedConfigHome
    {
      const pool = new pg.Pool({ connectionString: POSTGRES_URL, max: 1 })
      await pool.query(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`)
      await pool.query(`DROP SCHEMA IF EXISTS "${PG_PIN_SCHEMA}" CASCADE`)
      await pool.end()
    }
    if (PGDURABLE_URL) {
      const pool = new pg.Pool({ connectionString: PGDURABLE_URL, max: 1 })
      await cancelSchemaDurableInstances(pool, PGDURABLE_SCHEMA)
      await pool.query(`DROP SCHEMA IF EXISTS "${PGDURABLE_SCHEMA}" CASCADE`)
      await pool.end()
    }
  })

  it('runs the 12-task, 3-gate runner quest identically in every available mode', async () => {
    const projections: BackendProjection[] = []

    projections.push(
      await runScenario('postgres', ['--postgres-url', POSTGRES_URL, '--postgres-schema', PG_SCHEMA, '--postgres-no-durable']),
    )

    if (PGDURABLE_URL) {
      projections.push(
        await runScenario(
          'postgres+durable',
          ['--postgres-url', PGDURABLE_URL, '--postgres-schema', PGDURABLE_SCHEMA],
          'bridge',
        ),
      )
    } else {
      console.warn('[conformance] postgres+durable mode SKIPPED — set WAYPOINT_PGDURABLE_TEST_URL to include it')
    }

    console.info(`[conformance] backends exercised: ${projections.map((p) => p.backend).join(', ')}`)
    expect(projections.length).toBeGreaterThanOrEqual(1)

    // The scenario itself must have completed everywhere: three gates
    // approved in quest order, route complete.
    for (const projection of projections) {
      expect(projection.gateDecisions, `${projection.backend}: gate order`).toEqual([
        'plan-approval-gate',
        'verify-approval-gate',
        'ship-approval-gate',
      ])
      expect(projection.finalRoute.status, `${projection.backend}: final route status`).toBe('complete')
      expect(projection.gateApprovedEvents, `${projection.backend}: gate approvals in event surface`).toBeGreaterThanOrEqual(3)
    }

    // Cross-mode conformance: every projection equals the plain postgres
    // reference exactly. A mismatch here means a mode changed observable
    // semantics — fix the mode, not the projection.
    const [reference, ...rest] = projections.map(conformanceCore)
    for (const [index, candidate] of rest.entries()) {
      expect(candidate, `${projections[index + 1].backend} diverges from postgres`).toEqual(reference)
    }
  }, 420000)

  it('records approved gate tasks as lineage-derived done (the contract adopted from beads at its exit)', async () => {
    const pinned = await runScenario('postgres-pin', ['--postgres-url', POSTGRES_URL, '--postgres-schema', PG_PIN_SCHEMA, '--postgres-no-durable'])
    expect(pinned.finalTaskStatuses['plan-approval-gate']).toBe('done')
    expect(pinned.finalTaskStatuses['verify-approval-gate']).toBe('done')
    expect(pinned.finalTaskStatuses['ship-approval-gate']).toBe('done')
  }, 120000)
})
