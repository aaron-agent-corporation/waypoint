import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost } from '../engine-host.ts'

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

function realBdAvailable(): boolean {
  return spawnSync('bd', ['--version'], { encoding: 'utf8' }).status === 0
}

async function openFolderHost() {
  const root = await mkdtemp(join(tmpdir(), 'wp-run-adhoc-'))
  const host = createEngineHost()
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

describe('run.adhoc', () => {
  it('requires a questYaml', async () => {
    const { host } = await openFolderHost()
    const res = (await host.dispatch('run.adhoc', {})) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
    expect((res.details as { field?: string }).field).toBe('questYaml')
  })

  it('maps an invalid recipe manifest to a VALIDATION envelope', async () => {
    const { host } = await openFolderHost()
    const res = (await host.dispatch('run.adhoc', {
      questYaml: QUEST,
      recipeYamls: ['schema_version: 1\nslug: broken\n'],
      dryRun: true,
    })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })

  it('dryRun materializes a route without executing it', async () => {
    const { host } = await openFolderHost()
    const res = (await host.dispatch('run.adhoc', {
      questYaml: QUEST,
      recipeYamls: [RECIPE],
      dryRun: true,
    })) as unknown as { ok: boolean; route: { id: string; quest: string; metadata: Record<string, unknown> } }
    expect(res.ok).toBe(true)
    expect(res.route.quest).toBe('adhoc-demo')
    expect(res.route.metadata.adhoc).toBe(true)

    const tasks = (await host.dispatch('tasks.list', { routeId: res.route.id })) as unknown as {
      tasks: { kind: string; status: string }[]
    }
    expect(tasks.tasks.length).toBeGreaterThan(0)
    // dryRun did not run the autopilot: the recipe task stays open.
    expect(tasks.tasks.every((task) => task.status === 'open')).toBe(true)
  })

  it.runIf(realBdAvailable())('rejects the beads backend with VALIDATION', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-run-adhoc-beads-'))
    const host = createEngineHost()
    await host.dispatch('workspace.open', { root, backend: 'beads', initBeads: true })
    const res = (await host.dispatch('run.adhoc', { questYaml: QUEST })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
    expect((res.details as { field?: string }).field).toBe('backend')
  }, 120_000)
})
