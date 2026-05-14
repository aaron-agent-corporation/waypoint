import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runEndToEndHermesSmoke } from './end-to-end-hermes-smoke.ts'
import type { HermesProjectRecord } from './project-registry.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const hermesRuntimeAdapter = resolve(repoRoot, 'examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs')

function makeProject(): { project: HermesProjectRecord; cleanup: () => void } {
  const path = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-e2e-'))
  return {
    project: { name: 'fixture', path, waypointCli },
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  }
}

describe('end-to-end Hermes operator smoke', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  it('runs registry, safe commands, local Recipe runtime, discussion loop, and Telegram gate loop against one temp .waypoint project', async () => {
    const fixture = makeProject()
    cleanups.push(fixture.cleanup)

    const result = await runEndToEndHermesSmoke({
      registryYaml: `
projects:
  fixture:
    path: ${fixture.project.path}
    waypoint_cli: ${fixture.project.waypointCli}
`,
      projectName: 'fixture',
      runtimeAdapterPath: hermesRuntimeAdapter,
      nextNode: 'execute',
    })

    expect(result.project.path).toBe(fixture.project.path)
    expect(result.routeId).toBe('route-001')
    expect(result.recipeRuntime.status).toBe('blocked')
    expect(result.recipeRuntime.completedTasks.length).toBeGreaterThan(0)
    expect(result.recipeRuntime.events).toContain('route.autopilot.task.executed')
    expect(result.recipeRuntime.events).toContain('hermes-recipe-runtime-reference')
    expect(result.discussion.agentMessageId).toMatch(/^message-/)
    expect(result.discussion.loopPrevention?.requested).toBe(false)
    expect(result.gate.action).toBe('approve')
    expect(result.gate.command).toBe('waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute')
    expect(result.gate.message).toContain('status: active')
    expect(result.finalRoute).toContain('status: active')
    expect(result.events).toContain('route.gate.approved')
    expect(result.artifacts).toEqual(
      expect.objectContaining({
        config: expect.stringContaining('.waypoint/config.yaml'),
        tasksDirectory: expect.stringContaining('.waypoint/tasks'),
        eventsFile: expect.stringContaining('.waypoint/events/route-001.jsonl'),
      }),
    )

    const config = readFileSync(join(fixture.project.path, '.waypoint/config.yaml'), 'utf8')
    expect(config).toContain('recipe: local')
    expect(config).toContain(hermesRuntimeAdapter)
  }, 30000)

  it('leaves registered project paths explicit and fails closed for unknown registry project names', async () => {
    const fixture = makeProject()
    cleanups.push(fixture.cleanup)

    await expect(
      runEndToEndHermesSmoke({
        registryYaml: `
projects:
  fixture:
    path: ${fixture.project.path}
    waypoint_cli: ${fixture.project.waypointCli}
`,
        projectName: '../fixture',
        runtimeAdapterPath: hermesRuntimeAdapter,
      }),
    ).rejects.toThrow('Unknown Hermes Waypoint project: ../fixture')

    expect(existsSync(join(repoRoot, '.waypoint'))).toBe(false)
  })
})
