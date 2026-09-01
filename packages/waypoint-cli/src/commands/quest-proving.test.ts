/**
 * Q3: the quest corpus proving harness (docs/designs/q-quest-proving.md,
 * rsc-e1b). Runs EVERY bundled quest end to end on a scratch durable schema
 * with a real worker runtime (the W5-style fake agent reporting through the
 * built CLI), the harness standing in for the human at gates and landmark
 * waits. A quest "proves" only when the route completes AND every recipe plan
 * produced a finished dispatch — executed by a worker, never simulated.
 *
 * The EXPECTATIONS table below is the checked-in verdict per quest. Drift is
 * loud in BOTH directions: a quest that stops proving fails this suite, and a
 * quest that starts proving after authoring work forces its expectation to be
 * promoted. `shell: true` marks quests that complete without any recipe work.
 *
 * Gated twice: the live-PG requirement every suite shares, plus
 * WAYPOINT_QUEST_PROVING=1 — a full corpus pass is minutes of E2E, not default
 * suite material. Run it with:
 *   WAYPOINT_QUEST_PROVING=1 WAYPOINT_POSTGRES_TEST_URL=... WAYPOINT_PGDURABLE_TEST_URL=... \
 *     pnpm vitest run packages/waypoint-cli/src/commands/quest-proving.test.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  approveRouteGate,
  presentGateChangeset,
  cancelWaypointRoute,
  initWaypointProject,
  installQuestCatalog,
  loadBundledWaypointCatalog,
  resolveWaypointRouteBlocker,
  runWaypointBridge,
  startQuestRoute,
} from '@waypoint/folder-host'

import { PostgresTestProjects } from '../testing/backend-harness'

const TEST_URL = process.env.WAYPOINT_PGDURABLE_TEST_URL
const RUN_PROVING = process.env.WAYPOINT_QUEST_PROVING === '1' && typeof TEST_URL === 'string' && TEST_URL.trim() !== ''

type QuestVerdict = 'proves' | 'compile-refused' | 'start-refused' | 'plan-less'

interface QuestExpectation {
  readonly verdict: QuestVerdict
  /** Completes without a single recipe dispatch — an auto-done shell. */
  readonly shell?: true
  /** For 'start-refused': the guard message startQuestRoute must throw. */
  readonly startError?: RegExp
}

/**
 * One row per bundled quest — the suite asserts the catalog and this table
 * cover each other exactly, so adding or retiring a quest is a loud diff here.
 *
 * Verdicts beyond 'proves':
 * - 'compile-refused': admission refuses the quest before any route rows
 *   exist (artifact nodes with no durable execution mapping).
 * - 'start-refused': a start-time guard refuses on this scratch project, and
 *   the refusal IS the checked-in behavior.
 * - 'plan-less': materializes with no engine instance; recorded, not pumped.
 */
const EXPECTATIONS: Record<string, QuestExpectation> = {
  runner: { verdict: 'proves', shell: true },
}

interface QuestFinding {
  readonly quest: string
  readonly verdict: string
  readonly pumps?: number
  readonly recipePlans?: number
  readonly executedDispatches?: number
  readonly autoDonePlans?: readonly string[]
  readonly gatesApproved?: number
  readonly waitsResolved?: number
  readonly detail?: string
}

const findings: QuestFinding[] = []

const pgProjects = new PostgresTestProjects()

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
  if (findings.length > 0) {
    const lines = findings.map(
      (f) =>
        `${f.quest.padEnd(28)} ${f.verdict.padEnd(16)} recipes=${f.recipePlans ?? '-'} executed=${f.executedDispatches ?? '-'} auto-done=[${(f.autoDonePlans ?? []).join(', ')}]${f.detail ? ` :: ${f.detail}` : ''}`,
    )
    // The findings report IS the deliverable of a proving run.
    console.log(`\nquest proving findings (${findings.length} quests):\n${lines.join('\n')}`)
    const reportPath = process.env.WAYPOINT_QUEST_PROVING_REPORT
    if (reportPath) await writeFile(reportPath, JSON.stringify(findings, null, 2), 'utf8')
  }
})

/** W5-style fake agent: read the work order, report finished via the FILE
 * CLAIM — the work-order contract; workers have no route to the run database.
 * A review-bearing plan carries review_checks in its payload; the agent
 * itemizes a passing verdict for each in the claim's evidence, or admission
 * would (correctly) fail the plan. The claim also carries a `brief` —
 * gate-brief admission refuses a report whose completion opens a human
 * approval without one. */
function fakeAgentSource(): string {
  return `
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  const payload = JSON.parse(chunks.join('').match(/^Payload: (.+)$/m)[1])
  const evidence = { probe: 'quest-proving' }
  for (const check of payload.review_checks ?? []) {
    evidence['review.' + check] = 'pass:proving agent confirmed ' + check
  }
  const { writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const claimFile = join(payload.project_root, '.waypoint', 'claims', payload.route_id, payload.task_id + '.json')
  await writeFile(claimFile, JSON.stringify({
    task_id: payload.task_id,
    status: 'finished',
    summary: 'proving agent completed ' + payload.recipe_slug,
    brief: 'The proving agent completed this step and it is ready for your review.',
    evidence,
  }))
  process.exit(0)
})
`
}

interface PumpResult {
  readonly status: string
  readonly pumps: number
  readonly gatesApproved: number
  readonly waitsResolved: number
  readonly lastSnapshot: string
}

/**
 * Drive route-001 to completion: drain dispatches (worker runtime runs the
 * fake agent), approve every gate the route blocks at, resolve every landmark
 * wait. The engine advances in-database at ~1s per node, so pumps are paced
 * at 500ms and a snapshot that stops changing for 60 consecutive pumps is a
 * hang — exactly the symptom this harness exists to catch.
 */
async function pumpToCompletion(cwd: string, pool: pg.Pool, schema: string): Promise<PumpResult> {
  let gatesApproved = 0
  let waitsResolved = 0
  let stalled = 0
  let last = ''
  // 2400-pump ceiling: the stall detector below, not this ceiling, is the
  // wedge tripwire; the ceiling only bounds a livelocked-but-changing run.
  for (let pumps = 1; pumps <= 2400; pumps++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await runWaypointBridge(cwd, { once: true })
    const routeResult = await pool.query(`SELECT status, current_node FROM "${schema}".routes WHERE id = 'route-001'`)
    const route = routeResult.rows[0] as { status: string; current_node: string | null }
    if (route.status === 'complete') return { status: 'complete', pumps, gatesApproved, waitsResolved, lastSnapshot: last }

    if (route.status === 'blocked' && route.current_node !== null) {
      const kindResult = await pool.query(
        `SELECT kind, status FROM "${schema}".tasks WHERE route_id = 'route-001' AND plan_ref = $1`,
        [route.current_node],
      )
      const blockedRow = kindResult.rows[0] as { kind?: string; status?: string } | undefined
      // B5 stale-read window: after a decision the routes row stays 'blocked'
      // with current_node on the gate/wait for a beat while the engine
      // advances — a re-decision hits the engine's already-decided guard,
      // and a wait whose task row is already done fails the resolver's
      // non-done lookup. Both firings ARE progress inside this gate/wait
      // path; swallow them and keep pumping.
      try {
        if (blockedRow?.kind === 'gate') {
          // Changeset gates demand the digest the reviewer saw:
          // present-then-approve, exactly like a real reviewer. On a
          // completion gate the presentation returns no changeset and the
          // approve carries no digest — today's semantics.
          const presentation = await presentGateChangeset(cwd, 'route-001', route.current_node)
          await approveRouteGate(cwd, {
            routeId: 'route-001',
            node: route.current_node,
            note: 'quest-proving harness approval',
            changesetDigest: presentation.changeset?.digest,
          })
          gatesApproved += 1
        } else if (blockedRow?.kind === 'wait' && blockedRow.status !== 'done') {
          await resolveWaypointRouteBlocker(cwd, { routeId: 'route-001', note: 'quest-proving harness landmark' })
          waitsResolved += 1
        }
      } catch (error) {
        const message = String(error)
        if (!/already decided|already ended|is advancing past it|resolve a blocked task with/.test(message)) throw error
      }
    }

    // The snapshot includes the engine's own node-status histogram — across
    // the whole instance TREE, all statuses. Any node status transition
    // anywhere in the tree is progress.
    const snapshotResult = await pool.query(
      `SELECT (SELECT json_agg(json_build_array(id, status) ORDER BY id) FROM "${schema}".tasks)::text
           || (SELECT coalesce(json_agg(json_build_array(id, status) ORDER BY id), '[]')::text FROM "${schema}".dispatches)
           || (SELECT coalesce(json_agg(json_build_array(status, n) ORDER BY status), '[]')::text FROM (
                 SELECT n.status, count(*) AS n FROM df.nodes n, "${schema}".routes r
                 WHERE r.id = 'route-001' AND (n.instance_id = r.instance_id OR n.instance_id LIKE r.instance_id || '::%')
                 GROUP BY n.status) h)
           || $1 AS snap`,
      [`${route.status}:${route.current_node ?? ''}`],
    )
    const snapshot = (snapshotResult.rows[0] as { snap: string }).snap
    if (snapshot === last) {
      stalled += 1
      if (stalled >= 60) return { status: 'hung', pumps, gatesApproved, waitsResolved, lastSnapshot: snapshot }
    } else {
      stalled = 0
      last = snapshot
    }
  }
  return { status: 'exhausted-pumps', pumps: 2400, gatesApproved, waitsResolved, lastSnapshot: last }
}

describe.skipIf(!RUN_PROVING)('quest corpus proving (Q3, WAYPOINT_QUEST_PROVING=1)', () => {
  it('the expectations table and the bundled catalog cover each other exactly', async () => {
    const catalog = await loadBundledWaypointCatalog()
    const slugs = catalog.quests
      .list()
      .map((quest) => quest.slug)
      .sort()
    expect(slugs).toEqual(Object.keys(EXPECTATIONS).sort())
  })

  for (const [slug, expectation] of Object.entries(EXPECTATIONS)) {
    it(
      `${slug}: ${expectation.verdict}${expectation.shell ? ' (auto-done shell)' : ''}`,
      async () => {
        // Quest roots reach the config at start, which arms the per-project
        // seatbelt jail — so the corpus models production's layout: the case
        // root nests one level below its container, and the proving agent
        // lives in its own directory outside both.
        const container = await pgProjects.mkProjectRoot(`quest-prove-${slug}-`)
        const cwd = join(container, 'case')
        await mkdir(cwd, { recursive: true })
        pgProjects.track(cwd)
        const agentDir = await pgProjects.mkProjectRoot(`quest-prove-${slug}-agent-`)
        const agentScript = join(agentDir, 'proving-agent.mjs')
        await writeFile(agentScript, fakeAgentSource(), 'utf8')

        const project = await initWaypointProject(cwd, {
          quest: slug,
          postgres: { url: TEST_URL!, durable: true },
          runtime: {
            recipe: 'worker',
            worker: { command: process.execPath, args: [agentScript], concurrency: 4 },
          },
        })
        const schema = project.config.backend.postgres!.schema!
        const bundled = await loadBundledWaypointCatalog()
        await installQuestCatalog(cwd, bundled, { quest: slug })

        let startError: unknown
        let started = false
        try {
          await startQuestRoute(cwd, { quest: slug })
          started = true
        } catch (error) {
          startError = error
        }

        if (expectation.verdict === 'compile-refused') {
          expect(started, `${slug} should refuse at start (admission)`).toBe(false)
          expect(String(startError)).toMatch(/no durable execution mapping|artifact_verifier/)
          findings.push({ quest: slug, verdict: 'compile-refused', detail: String(startError).slice(0, 160) })
          return
        }
        if (expectation.verdict === 'start-refused') {
          expect(started, `${slug} should refuse at start (guard: ${expectation.startError})`).toBe(false)
          expect(String(startError)).toMatch(expectation.startError!)
          findings.push({ quest: slug, verdict: 'start-refused', detail: String(startError).slice(0, 160) })
          return
        }
        if (startError !== undefined) throw startError

        const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
        try {
          if (expectation.verdict === 'plan-less') {
            // No scaffold plans → no engine instance; the route materializes
            // and nothing advances it. Recorded, not pumped.
            const instance = await pool.query(`SELECT instance_id FROM "${schema}".routes WHERE id = 'route-001'`)
            expect((instance.rows[0] as { instance_id: string | null }).instance_id).toBeNull()
            findings.push({ quest: slug, verdict: 'plan-less' })
            return
          }

          const pump = await pumpToCompletion(cwd, pool, schema)
          const tasks = await pool.query(
            `SELECT plan_ref, kind, status, evidence FROM "${schema}".tasks WHERE route_id = 'route-001' ORDER BY id`,
          )
          const dispatches = await pool.query(
            `SELECT task_ref, status, close_reason FROM "${schema}".dispatches WHERE route_id = 'route-001' ORDER BY id`,
          )
          const taskRows = tasks.rows as { plan_ref: string; kind: string; status: string; evidence: { skipped?: boolean } | null }[]
          const dispatchRows = dispatches.rows as { task_ref: string; status: string; close_reason: string | null }[]

          const recipePlans = taskRows.filter((row) => row.kind === 'recipe')
          const executed = dispatchRows.filter((row) => row.status === 'completed' && row.close_reason === 'finished')
          const autoDone = taskRows
            .filter((row) => row.kind !== 'recipe' && row.kind !== 'gate' && row.kind !== 'wait')
            .map((row) => row.plan_ref)

          findings.push({
            quest: slug,
            verdict: pump.status === 'complete' ? (recipePlans.length === 0 ? 'proves (shell)' : 'proves') : pump.status,
            pumps: pump.pumps,
            recipePlans: recipePlans.length,
            executedDispatches: executed.length,
            autoDonePlans: autoDone,
            gatesApproved: pump.gatesApproved,
            waitsResolved: pump.waitsResolved,
            ...(pump.status !== 'complete' ? { detail: pump.lastSnapshot.slice(0, 300) } : {}),
          })

          expect(pump.status, `${slug} must complete (last state: ${pump.lastSnapshot.slice(0, 400)})`).toBe('complete')
          // Every recipe plan was EXECUTED by the worker (finished dispatch),
          // unless a when-predicate skipped it on record.
          for (const plan of recipePlans) {
            if (plan.evidence?.skipped === true) continue
            expect(
              dispatchRows.some((row) => row.task_ref === plan.plan_ref && row.status === 'completed' && row.close_reason === 'finished'),
              `${slug}: recipe plan '${plan.plan_ref}' has no finished dispatch — nothing executed it`,
            ).toBe(true)
          }
          // Shell accounting stays truthful in both directions.
          expect(
            recipePlans.length === 0,
            `${slug}: shell flag drift — expectation says shell=${expectation.shell === true}, corpus says ${recipePlans.length === 0}`,
          ).toBe(expectation.shell === true)
        } finally {
          // Teardown hygiene: a route left running would keep replaying after
          // the schema drop and pile failed instances into df.instances.
          try {
            const state = await pool.query(`SELECT status FROM "${schema}".routes WHERE id = 'route-001'`)
            const status = (state.rows[0] as { status?: string } | undefined)?.status
            if (status !== undefined && status !== 'complete' && status !== 'cancelled') {
              await cancelWaypointRoute(cwd, { routeId: 'route-001', reason: 'quest-proving teardown' })
            }
          } catch {
            // Best-effort — a quest that never started has nothing to cancel.
          }
          await pool.end()
        }
      },
      300_000,
    )
  }
})
