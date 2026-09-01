/**
 * S2 (item 52): the binding is ON THE ROWS.
 *
 * Two durable records carry the sandbox provenance:
 *   - the ROUTE row: start reads the per-project provisioning record and
 *     stamps `metadata.sandbox`, so dispatch admission reads the binding the
 *     route STARTED under (this suite drives the real startAdhocRoute);
 *   - the DISPATCH row: the bridge stamps the `sandbox` column at close from
 *     the runtime output's admitted binding (this suite drives the real
 *     bridge close path with an injected runtime, the same seam every kind
 *     shares — the jailed runtime's side is unit-proven in
 *     cordis-jailed-runtime.test.ts, and the full sprite chain is the item-52
 *     live witness).
 *
 * Requires the live Postgres every durable suite shares.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init.ts'
import { startAdhocRoute } from '../routes/start-adhoc.ts'
import { runWaypointBridge } from './bridge.ts'
import { PostgresTestProjects, requireTestPostgresUrl } from '../testing/postgres.ts'

const TEST_URL = requireTestPostgresUrl()

// A one-plan quest whose single recipe node runs on the injected bridge
// runtime (no runtime.kind → the generic worker branch).
const STAMP_QUEST = `schema_version: 1
slug: sandbox-stamp-demo
name: Sandbox Stamp Demo
workflow: workflows/stamp/demo.yaml
recipes:
  - stamp-echo
scaffolds:
  workstreams:
    - key: delivery
      name: Delivery
      milestones:
        - version_label: v1
          title: Sandbox stamp demo
          phases:
            - phase_key: "10"
              phase_slug: run
              lifecycle_phase: execute
              plans:
                - plan_ref: stamp-run-echo
                  title: Run the stamped recipe
                  wave: 10
                  metadata:
                    runner:
                      node:
                        type: recipe
                      recipe:
                        slug: stamp-echo
`

const STAMP_RECIPE = `schema_version: 1
slug: stamp-echo
name: Stamp Echo
prompt: Echo and report.
`

/** What the runtime output carries — the ADMITTED binding shape. */
const ATTEMPT_BINDING = {
  provider: 'fake',
  project_id: 'prj_stamp_demo',
  sandbox_instance_id: 'spr_demo_1',
  sandbox_name: 'project-prj-stamp-demo',
  image_digest: `localhost/waypoint/cordis-worker@sha256:${'d'.repeat(64)}`,
  policy_hash: 'e'.repeat(64),
  mount_hash: 'f'.repeat(64),
  generation: 1,
  workspace_id: 'ws-stamp-demo',
}

const pgProjects = new PostgresTestProjects()

describe('sandbox binding on the durable rows (item 52)', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('start stamps the provisioning record on the ROUTE row; the bridge stamps the attempt binding on the DISPATCH row', async () => {
    const root = await pgProjects.mkProjectRoot('sandbox-stamp-')
    const project = await initWaypointProject(root, {
      quest: 'runner',
      postgres: { url: TEST_URL, durable: true },
      runtime: {
        recipe: 'worker',
        worker: { command: process.execPath, args: ['-e', 'process.exit(1)'] },
        // A fake-backend sandbox: real admission grammar, no cloud calls. The
        // injected bridge runtime below stands in for the jailed run.
        sandbox: {
          backend: 'fake',
          image: 'localhost/waypoint/cordis-worker:slim',
          egress: { default: 'deny', allow: ['api.openai.com'] },
        },
      },
    })
    const schema = project.config.backend.postgres!.schema!

    // The per-project provisioning record start stamps onto the route row.
    await mkdir(join(root, '.waypoint', 'sandbox'), { recursive: true })
    await writeFile(
      join(root, '.waypoint', 'sandbox', 'binding.json'),
      JSON.stringify({
        project_id: 'prj_stamp_demo',
        provider: 'fake',
        sandbox_instance_id: 'spr_demo_1',
        image_digest: ATTEMPT_BINDING.image_digest,
        policy_hash: ATTEMPT_BINDING.policy_hash,
        mount_hash: ATTEMPT_BINDING.mount_hash,
        generation: 1,
        workspace_id: 'ws-stamp-demo',
      }),
      'utf8',
    )

    const route = await startAdhocRoute(root, {
      sessionId: 'sandbox-stamp',
      questYaml: STAMP_QUEST,
      recipeYamls: [STAMP_RECIPE],
      dryRun: false,
    })
    expect(route.status).toBe('active')

    const pool = new pg.Pool({ connectionString: TEST_URL, max: 2 })
    try {
      // ROUTE row: the admitted binding the route started under.
      const routeRow = await pool.query(
        `SELECT metadata -> 'sandbox' AS sandbox FROM "${schema}".routes WHERE id = $1`,
        [route.id],
      )
      expect(routeRow.rows[0]?.sandbox).toMatchObject({
        project_id: 'prj_stamp_demo',
        sandbox_provider: 'fake',
        sandbox_instance_id: 'spr_demo_1',
        sandbox_generation: 1,
      })

      // DISPATCH row: pump the real bridge with a runtime whose output carries
      // the admitted binding — the close path must land it on the column.
      const runRecipe = async () => ({ status: 'finished', summary: 'stamped', sandbox: ATTEMPT_BINDING })
      let stamped: { sandbox: unknown; close_reason: string | null } | undefined
      for (let pump = 0; pump < 30 && stamped === undefined; pump++) {
        await runWaypointBridge(root, { once: true, runtime: { runRecipe } })
        const q = await pool.query(
          `SELECT sandbox, close_reason FROM "${schema}".dispatches
            WHERE route_id = $1 AND status = 'completed'
            ORDER BY id DESC LIMIT 1`,
          [route.id],
        )
        if (q.rows.length > 0) stamped = q.rows[0] as typeof stamped
        else await new Promise((resolve) => setTimeout(resolve, 200))
      }

      expect(stamped, 'the dispatch never settled — the bridge may not have run it').toBeDefined()
      expect(stamped!.sandbox).toMatchObject({
        provider: 'fake',
        project_id: 'prj_stamp_demo',
        sandbox_instance_id: 'spr_demo_1',
        image_digest: ATTEMPT_BINDING.image_digest,
      })
    } finally {
      await pool.end()
    }
  }, 60_000)
})
