// Item 53: the pi runtime is retired for workers (cordis-only). These are the
// retired path's own tests — run under the documented escape, never in product.

/**
 * Production-fork proof for `runtime.kind: 'pi'` (rsc-wwm.1).
 *
 * The pi runtime is live-proven in ISOLATION (pi-jailed-invivo,
 * pi-jailed-sandbox-invivo — real Codex) and its fail-closed behavior is
 * unit-covered, but until this suite NOTHING drove the production dispatch fork
 * that SELECTS it: pgdurable/bridge.ts routes `recipe.runtime.kind === 'pi'` to
 * `piRecipeRuntimeFor`, and no test exercised that branch end to end. The pivot
 * rested on isolated proofs, not a production-path dispatch.
 *
 * This drives the REAL durable bridge through one full `kind: pi` dispatch on a
 * live scratch schema — no live model needed. The recipe declares no model
 * target, so the pi runtime is constructed, runs, and fails CLOSED at model
 * routing (`model routing failed: …`, pi-runtime.ts) — a fingerprint no other
 * runtime emits. That the dispatched attempt carries that evidence proves the
 * whole production wiring: the bridge loaded the manifest, read
 * `runtime.kind: 'pi'`, forked to `PiRecipeRuntime`, ran it, and recorded its
 * outcome back onto the durable task. The happy path (a real turn) is the
 * in-vivo suites' job; this is the deterministic wiring proof CI can keep.
 *
 * Requires the live Postgres every durable suite shares.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init.ts'
import { startAdhocRoute } from '../routes/start-adhoc.ts'
import { runWaypointBridge } from '../pgdurable/bridge.ts'
import { readBrokeredCredential } from './pi-cred-broker.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import { PostgresTestProjects, requireTestPostgresUrl } from '../testing/postgres.ts'

// Phase 0, item 10: this used to read WAYPOINT_POSTGRES_TEST_URL raw and skip the
// whole suite when it was unset. A standard install HAS a Postgres — the
// Console manages one under launchd — so the skip fired on ordinary checkouts
// and this coverage simply never ran, while the run still reported green.
// `requireTestPostgresUrl()` defaults to that instance and fails loud at
// connect time if it is genuinely absent, which is the behaviour every other
// durable suite already has.
const TEST_URL = requireTestPostgresUrl()

// The in-vivo capstone: real Codex subscription (non-metered), off ~/.pi.
const INVIVO = process.env.WAYPOINT_PI_INVIVO === '1'
const PROVIDER = 'openai-codex'
const MODEL = 'gpt-5.4'

// A one-plan quest whose single recipe node dispatches a `kind: pi` recipe.
const PI_QUEST = `schema_version: 1
slug: pi-dispatch-demo
name: Pi Dispatch Demo
workflow: workflows/pi/demo.yaml
recipes:
  - pi-echo
scaffolds:
  workstreams:
    - key: delivery
      name: Delivery
      milestones:
        - version_label: v1
          title: Pi dispatch demo
          phases:
            - phase_key: "10"
              phase_slug: run
              lifecycle_phase: execute
              plans:
                - plan_ref: pi-run-echo
                  title: Run the pi recipe
                  wave: 10
                  metadata:
                    runner:
                      node:
                        type: recipe
                      recipe:
                        slug: pi-echo
`

// The recipe is `runtime.kind: pi`. With no project model target the pi runtime
// fails closed at routing — that failure IS the proof the fork selected it.
const PI_RECIPE = `schema_version: 1
slug: pi-echo
name: Pi Echo
prompt: Reason about the payload and report.
runtime:
  kind: pi
  model_class: high
`

const pgProjects = new PostgresTestProjects()

describe('kind: pi durable dispatch (rsc-wwm.1)', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('the durable bridge forks a kind:pi recipe to PiRecipeRuntime and records its outcome', async () => {
    const root = await pgProjects.mkProjectRoot('pi-dispatch-')
    // A non-null base runtime so the bridge LOADS the recipe manifest (a
    // NullRecipeRuntime nulls the recipe and skips every kind-fork). The worker
    // command is a placeholder — the pi fork never spawns it. model_targets is
    // deliberately unset so the pi runtime fails closed at routing.
    const project = await initWaypointProject(root, {
      quest: 'runner',
      postgres: { url: TEST_URL, durable: true },
      runtime: { recipe: 'worker', worker: { command: process.execPath, args: ['-e', 'process.exit(1)'] } },
    })
    const schema = project.config.backend.postgres!.schema!

    const route = await startAdhocRoute(root, {
      sessionId: 'pi-dispatch',
      questYaml: PI_QUEST,
      recipeYamls: [PI_RECIPE],
      dryRun: false,
    })
    expect(route.status).toBe('active')

    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // Drive the real bridge until the pi dispatch settles (fails closed) or a
      // hard cap. The pi fork resolves the model synchronously and fails at once,
      // so a couple of drains suffice; the cap only guards a wedge.
      // A non-finished attempt lands off-graph: the dispatch closes with
      // close_reason 'failed', and the masked runtime payload is recorded on the
      // task at metadata.runner.evidence (the `evidence` COLUMN stays the
      // engine's). Read both.
      let settled: { close_reason: string | null; evidence: unknown } | undefined
      for (let pump = 0; pump < 30 && settled === undefined; pump++) {
        await runWaypointBridge(root, { once: true })
        const q = await pool.query(
          `SELECT d.close_reason, t.metadata #> '{runner,evidence}' AS evidence
             FROM "${schema}".dispatches d
             JOIN "${schema}".tasks t ON t.route_id = d.route_id AND t.plan_ref = d.task_ref
            WHERE d.route_id = $1 AND d.status = 'completed'
            ORDER BY d.id DESC LIMIT 1`,
          [route.id],
        )
        if (q.rows.length > 0) settled = q.rows[0] as typeof settled
        else await new Promise((resolve) => setTimeout(resolve, 200))
      }

      expect(settled, 'the pi dispatch never settled — the fork may not have run').toBeDefined()
      // The pi runtime failed CLOSED at model routing: the fork selected it.
      expect(settled!.close_reason).toBe('failed')
      const evidence = JSON.stringify(settled!.evidence ?? {})
      expect(evidence, `expected the pi runtime's routing-failure fingerprint, got: ${evidence}`).toMatch(
        /model routing failed/,
      )
    } finally {
      await pool.end()
    }
  }, 60_000)

  it('the autopilot forks a kind:pi recipe to PiRecipeRuntime and records its outcome', async () => {
    // The non-durable adhoc path drives through the autopilot, which takes the
    // SAME kind:pi fork (autopilot/run.ts). It auto-runs on start and returns the
    // final autopilot result; no bridge to pump. The recipe again declares no
    // model target, so the pi runtime fails closed at routing.
    const root = await pgProjects.mkProjectRoot('pi-dispatch-autopilot-')
    await initWaypointProject(root, {
      quest: 'runner',
      postgres: { url: TEST_URL, durable: false },
      runtime: { recipe: 'worker', worker: { command: process.execPath, args: ['-e', 'process.exit(1)'] } },
    })

    const route = await startAdhocRoute(root, {
      sessionId: 'pi-dispatch-autopilot',
      questYaml: PI_QUEST,
      recipeYamls: [PI_RECIPE],
      dryRun: false,
    })
    // The pi runtime failed closed at routing → the autopilot marks the run failed.
    expect(route.autopilot?.status).toBe('failed')

    const tasks = await listWaypointTasks(root)
    const recipeTask = tasks.find((task) => task.route_id === route.id && task.kind === 'recipe')
    expect(recipeTask, 'no recipe task materialized — the fork had nothing to run').toBeDefined()
    expect(recipeTask!.status).toBe('failed')
    // The pi runtime's failure payload rode back onto the task at
    // metadata.runner.autopilot (mergeTaskMetadata nests under `runner`) —
    // assert its routing-failure fingerprint.
    const runner = (recipeTask!.metadata as { runner?: { autopilot?: unknown } } | null)?.runner
    const evidence = JSON.stringify(runner?.autopilot ?? {})
    expect(evidence, `expected the pi runtime's routing-failure fingerprint, got: ${evidence}`).toMatch(
      /model routing failed/,
    )
  }, 60_000)

  // The capstone: a REAL pi worker completing a durable dispatch through the
  // production bridge and advancing the route to completion — the one claim the
  // deterministic tests above cannot make (they prove the fork wiring via the
  // fail-closed branch; the finished→signal→advance path is shared bridge
  // machinery, proven for worker/deterministic recipes, but never with a real pi
  // worker). Gated on WAYPOINT_PI_INVIVO=1 + a live ~/.pi Codex credential.
  it.skipIf(!INVIVO)(
    'in vivo: a real pi worker completes a durable dispatch and advances the route (rsc-wwm.1)',
    async (ctx) => {
      if ((await readBrokeredCredential(PROVIDER)) === undefined) {
        ctx.skip()
        return
      }
      // The provider registry is read from WAYPOINT_CONFIG_HOME (the harness
      // sandboxes it), so declare the Codex subscription there. The credential
      // itself still comes from the real ~/.pi (untouched by the sandbox).
      await writeFile(
        join(pgProjects.configHome!, 'config.yaml'),
        `model_providers:\n  ${PROVIDER}:\n    auth: subscription\n`,
        'utf8',
      )

      const root = await pgProjects.mkProjectRoot('pi-dispatch-invivo-')
      const project = await initWaypointProject(root, {
        quest: 'runner',
        postgres: { url: TEST_URL, durable: true },
        runtime: {
          recipe: 'worker',
          worker: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
          model_targets: { high: { provider: PROVIDER, model: MODEL } },
        },
      })
      const schema = project.config.backend.postgres!.schema!

      // A tool-less reason-and-report pi recipe: it runs IN-PROCESS (no jail) and
      // reports finished via the always-present submit_report claim.
      const recipe = `schema_version: 1
slug: pi-echo
name: Pi Echo
prompt: >
  Reply with a one-sentence acknowledgement, then call submit_report with
  status finished and a short summary. Do not use any other tool.
runtime:
  kind: pi
  model_class: high
`
      const route = await startAdhocRoute(root, {
        sessionId: 'pi-dispatch-invivo',
        questYaml: PI_QUEST,
        recipeYamls: [recipe],
        dryRun: false,
      })
      expect(route.status).toBe('active')

      const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
      try {
        let status = ''
        for (let pump = 0; pump < 120 && status !== 'complete'; pump++) {
          await runWaypointBridge(root, { once: true })
          const q = await pool.query(`SELECT status FROM "${schema}".routes WHERE id = $1`, [route.id])
          status = (q.rows[0] as { status: string }).status
          if (status === 'failed' || status === 'cancelled') break
          if (status !== 'complete') await new Promise((resolve) => setTimeout(resolve, 500))
        }
        expect(status, 'the route did not complete — the real pi dispatch never advanced it').toBe('complete')

        // The recipe plan was EXECUTED (a finished dispatch), not simulated.
        const d = await pool.query(
          `SELECT status, close_reason FROM "${schema}".dispatches WHERE route_id = $1 ORDER BY id DESC LIMIT 1`,
          [route.id],
        )
        const dispatch = d.rows[0] as { status: string; close_reason: string | null }
        expect(dispatch.status).toBe('completed')
        expect(dispatch.close_reason).toBe('finished')
      } finally {
        await pool.end()
      }
    },
    300_000,
  )
})
