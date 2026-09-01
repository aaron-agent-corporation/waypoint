import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { stringify as yamlStringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createWaypointProjectConfig } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { initWaypointProject } from '../project/init.ts'
import { registerArtifactContract } from '../runtime/artifact-contracts.ts'
import { PostgresTestProjects } from '../testing/postgres.ts'
import { listWaypointRuntimeTasks } from './read-model.ts'
import { getWaypointRoute } from './store.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import { startAdhocRoute, AdhocManifestError, buildAdhocRecipeQuestYaml } from './start-adhoc.ts'

const pgProjects = new PostgresTestProjects()

// A test-local vetted contract — the registry ships empty; hosts register
// their own. Registered once for the whole file (re-registration replaces).
registerArtifactContract('test-placement-plan', async () => [])

const QUEST = `schema_version: 1
slug: adhoc-demo
name: Adhoc Demo
workflow: workflows/adhoc/demo.yaml
recipes:
  - adhoc-echo
scaffolds:
  workstreams:
    - key: delivery
      name: Delivery
      milestones:
        - version_label: v1
          title: Adhoc demo
          phases:
            - phase_key: "10"
              phase_slug: run
              lifecycle_phase: execute
              plans:
                - plan_ref: adhoc-run-echo
                  title: Run echo recipe
                  wave: 10
                  metadata:
                    runner:
                      node:
                        type: recipe
                      recipe:
                        slug: adhoc-echo
`

const RECIPE = `schema_version: 1
slug: adhoc-echo
name: Adhoc Echo
prompt: Echo the payload.
`

async function initProject(): Promise<string> {
  const root = await pgProjects.mkProjectRoot('runner-adhoc-')
  // Plain postgres (durable: false): adhoc routes run through the autopilot,
  // which refuses engine-driven (durable) projects.
  await initWaypointProject(root, { quest: 'runner', postgres: { durable: false } })
  return root
}

/** Rewrite config.yaml so recipe tasks execute via a local command (for the abort test). */
async function useLocalRuntime(root: string, command: string, args: readonly string[]): Promise<void> {
  const base = createWaypointProjectConfig({ quest: 'runner' })
  const config = { ...base, runtime: { recipe: 'local' as const, command, args } }
  await writeFile(getWaypointProjectPaths(root).configPath, yamlStringify(config), 'utf8')
}

describe('startAdhocRoute', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('starts + materializes from a session overlay without touching the live catalog', async () => {
    const root = await initProject()
    const r = await startAdhocRoute(root, { sessionId: 's1', questYaml: QUEST, recipeYamls: [RECIPE], dryRun: true })

    expect(r.quest).toBe('adhoc-demo')
    expect(r.backend).toBe('postgres')
    expect((r.metadata as Record<string, unknown>).adhoc).toBe(true)
    expect((r.metadata as Record<string, unknown>).sessionId).toBe('s1')

    // No writes to the live catalog.
    expect(existsSync(join(root, '.waypoint', 'quests', 'adhoc-demo.yaml'))).toBe(false)
    expect(existsSync(join(root, '.waypoint', 'recipes', 'adhoc-echo.yaml'))).toBe(false)

    // Drafts land in the session overlay.
    expect(existsSync(join(root, '.waypoint', 'agent', 's1', 'catalog', 'quests', 'adhoc-demo.yaml'))).toBe(true)
    expect(existsSync(join(root, '.waypoint', 'agent', 's1', 'catalog', 'recipes', 'adhoc-echo.yaml'))).toBe(true)

    const tasks = await listWaypointRuntimeTasks(root, { routeId: r.id })
    expect(tasks.length).toBeGreaterThan(0)
    // dryRun does not execute: the recipe task stays open.
    expect(tasks.every((task) => task.status === 'open')).toBe(true)
  })

  it('buildAdhocRecipeQuestYaml: the synthesized one-plan quest materializes a task with full recipe-plan metadata', async () => {
    const root = await initProject()
    const quest = buildAdhocRecipeQuestYaml({
      recipe: 'adhoc-echo',
      produces: ['build/plan.json'],
      contract: 'test-placement-plan',
      access: { build: 'rw' },
      slugSuffix: 't1',
    })
    expect(quest.slug).toBe('adhoc-adhoc-echo-t1')

    const r = await startAdhocRoute(root, { sessionId: 's3', questYaml: quest.yaml, recipeYamls: [RECIPE], dryRun: true })
    expect(r.quest).toBe('adhoc-adhoc-echo-t1')

    const tasks = (await listWaypointTasks(root)).filter((task) => task.route_id === r.id)
    const plan = tasks.find((task) => {
      const runner = (task.metadata as Record<string, Record<string, unknown>> | null)?.runner
      return runner?.recipe !== undefined
    })
    expect(plan).toBeDefined()
    const runner = (plan!.metadata as Record<string, Record<string, unknown>>).runner
    expect(runner.recipe).toEqual({ slug: 'adhoc-echo' })
    expect(runner.output_artifacts).toEqual(['build/plan.json'])
    expect(runner.artifact_verifier).toEqual({ kind: 'required_paths', checks: ['exists', 'non_empty'] })
    expect(runner.artifact_contract).toBe('test-placement-plan')
    expect(runner.access).toEqual({ build: 'rw' })
  })

  it('buildAdhocRecipeQuestYaml: the synthesized quest passes DURABLE admission with an artifact contract (df.start compiles it)', async () => {
    const root = await pgProjects.mkProjectRoot('runner-adhoc-durable-')
    await initWaypointProject(root, { quest: 'runner', postgres: { durable: true }, runtime: { recipe: 'null' } })

    const quest = buildAdhocRecipeQuestYaml({
      recipe: 'adhoc-echo',
      produces: ['build/plan.json'],
      contract: 'test-placement-plan',
      slugSuffix: 'd1',
    })
    const r = await startAdhocRoute(root, { sessionId: 's4', questYaml: quest.yaml, recipeYamls: [RECIPE], dryRun: false })
    expect(r.status).toBe('active')
    expect(r.autopilot).toBeUndefined()

    // An unvetted contract refuses at the same durable admission, loudly.
    const bad = buildAdhocRecipeQuestYaml({
      recipe: 'adhoc-echo',
      produces: ['build/plan.json'],
      contract: 'not-a-vetted-contract',
      slugSuffix: 'd2',
    })
    await expect(
      startAdhocRoute(root, { sessionId: 's5', questYaml: bad.yaml, recipeYamls: [RECIPE], dryRun: false }),
    ).rejects.toThrow(/not in the vetted contract registry/)
  })

  it('buildAdhocRecipeQuestYaml: a contract without produced artifacts refuses (nothing to judge)', () => {
    expect(() =>
      buildAdhocRecipeQuestYaml({ recipe: 'x', contract: 'test-placement-plan', slugSuffix: 's' }),
    ).toThrow(AdhocManifestError)
    expect(() => buildAdhocRecipeQuestYaml({ recipe: 'x', access: { build: 'rwx' }, slugSuffix: 's' })).toThrow(
      AdhocManifestError,
    )
  })

  it('rejects an invalid recipe manifest with a typed field error', async () => {
    const root = await initProject()
    await expect(
      startAdhocRoute(root, { sessionId: 's1', questYaml: QUEST, recipeYamls: ['schema_version: 1\nslug: x\n'], dryRun: true }),
    ).rejects.toBeInstanceOf(AdhocManifestError)
  })

  it('aborts a long-running recipe: route ends cancelled and the child is killed', async () => {
    const root = await initProject()

    // The child ANNOUNCES itself by touching a marker, then runs forever until
    // signalled. `node -e <script> <arg>` puts <arg> at process.argv[1].
    //
    // rsc-7p9: this used to sleep a flat 400ms before aborting, and failed ~50%
    // of the time in the full suite while passing alone. Not slowness — a race
    // with a real fork in behavior. The task only reaches 'cancelled' if the
    // runtime returns 'stopped', which requires a child that is actually
    // RUNNING; abort before the autopilot dispatches and it takes the
    // early-abort path instead, cancelling the route and leaving the task
    // 'open'. That is precisely the observed failure (expected 'open' to be
    // 'cancelled'), so a bigger sleep would only have made the race rarer and
    // the eventual failure more confusing. Waiting on the marker aborts on a
    // FACT — the child exists — instead of on a guess about scheduling.
    const marker = join(root, 'child-up.marker')
    await useLocalRuntime(root, process.execPath, [
      '-e',
      "require('node:fs').writeFileSync(process.argv[1], 'up'); process.stdin.resume(); setInterval(() => {}, 1000)",
      marker,
    ])

    const controller = new AbortController()
    const started = startAdhocRoute(root, {
      sessionId: 's2',
      questYaml: QUEST,
      recipeYamls: [RECIPE],
      dryRun: false,
      signal: controller.signal,
    })

    const deadline = Date.now() + 10_000
    while (!existsSync(marker)) {
      if (Date.now() > deadline) throw new Error('the recipe child never started — nothing to abort, so the test would prove nothing')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    controller.abort()

    const result = await started
    expect(result.autopilot?.status).toBe('cancelled')

    const route = await getWaypointRoute(root, result.id)
    expect(route?.status).toBe('cancelled')

    const tasks = await listWaypointTasks(root)
    const recipeTask = tasks.find((task) => task.route_id === result.id && task.kind === 'recipe')
    expect(recipeTask?.status).toBe('cancelled')
  }, 15000)
})
