import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stringify as yamlStringify } from 'yaml'
import { describe, expect, it } from 'vitest'

import { createWaypointProjectConfig } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { initWaypointProject } from '../project/init.ts'
import { listWaypointRuntimeTasks } from './read-model.ts'
import { getWaypointRoute } from './store.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import { startAdhocRoute, AdhocManifestError } from './start-adhoc.ts'

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
                    waypoint:
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

async function initFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'waypoint-adhoc-'))
  await initWaypointProject(root, { quest: 'waypoint', backend: 'folder' })
  return root
}

/** Rewrite config.yaml so recipe tasks execute via a local command (for the abort test). */
async function useLocalRuntime(root: string, command: string, args: readonly string[]): Promise<void> {
  const base = createWaypointProjectConfig({ quest: 'waypoint', backend: 'folder' })
  const config = { ...base, runtime: { recipe: 'local' as const, command, args } }
  await writeFile(getWaypointProjectPaths(root).configPath, yamlStringify(config), 'utf8')
}

describe('startAdhocRoute', () => {
  it('starts + materializes from a session overlay without touching the live catalog', async () => {
    const root = await initFolder()
    const r = await startAdhocRoute(root, { sessionId: 's1', questYaml: QUEST, recipeYamls: [RECIPE], dryRun: true })

    expect(r.quest).toBe('adhoc-demo')
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

  it('rejects an invalid recipe manifest with a typed field error', async () => {
    const root = await initFolder()
    await expect(
      startAdhocRoute(root, { sessionId: 's1', questYaml: QUEST, recipeYamls: ['schema_version: 1\nslug: x\n'], dryRun: true }),
    ).rejects.toBeInstanceOf(AdhocManifestError)
  })

  it('aborts a long-running recipe: route ends cancelled and the child is killed', async () => {
    const root = await initFolder()
    // A child that ignores stdin close and runs effectively forever until signalled.
    await useLocalRuntime(root, process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'])

    const controller = new AbortController()
    const started = startAdhocRoute(root, {
      sessionId: 's2',
      questYaml: QUEST,
      recipeYamls: [RECIPE],
      dryRun: false,
      signal: controller.signal,
    })

    // Give the autopilot time to spawn the long child, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 400))
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
