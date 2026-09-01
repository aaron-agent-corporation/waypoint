import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

const pgProjects = new PostgresTestProjects()

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
})

async function startedProject(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-tasks-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

/**
 * A project on a quest that actually dispatches recipes.
 *
 * The bundled catalog ships only the `runner` lifecycle scaffold, whose every
 * plan is a checkpoint or a discussion — no recipe dispatch. The two tests
 * below are about how `tasks show` renders a RECIPE task, so they scaffold a
 * minimal recipe-bearing quest into the project and find the task by kind
 * rather than by hardcoding a task number: the contract is "a recipe task
 * shows its recipe", not "task-004 does".
 */
const RECIPE_PROBE_QUEST = `schema_version: 1
slug: recipe-probe
name: Recipe Probe
workflow: recipe-probe
description: one recipe dispatch for CLI rendering tests.

recipes:
  - probe-recipe

metadata:
  safety:
    source_files_read_only: true

scaffolds:
  workstreams:
    - key: recipe-probe
      name: Recipe Probe
      milestones:
        - version_label: v1
          title: Probe
          phases:
            - phase_key: RP1
              phase_slug: work
              lifecycle_phase: execute
              plans:
                - plan_ref: probe-work
                  title: Run the probe recipe
                  wave: 1
                  metadata:
                    runner:
                      recipe:
                        slug: probe-recipe
                      node:
                        type: recipe
`

const PROBE_RECIPE = `schema_version: 1
slug: probe-recipe
name: probe-recipe
prompt: Do the probe work.
`

async function startedRecipeProject(): Promise<{ cwd: string; taskId: string; recipe: string }> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-tasks-recipe-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(cwd, '.waypoint', 'quests'), { recursive: true })
  await mkdir(join(cwd, '.waypoint', 'recipes'), { recursive: true })
  await writeFile(join(cwd, '.waypoint', 'quests', 'recipe-probe.yaml'), RECIPE_PROBE_QUEST)
  await writeFile(join(cwd, '.waypoint', 'recipes', 'probe-recipe.yaml'), PROBE_RECIPE)
  await runWaypointCli(['start', '--quest', 'recipe-probe'], silentIo(cwd))

  const { io, stdout } = makeIo(cwd)
  expect(await runWaypointCli(['tasks', '--json'], io)).toBe(0)
  const parsed = JSON.parse(stdout.join('\n')) as {
    tasks: Array<{ id: string; kind: string; metadata?: { runner?: { recipe?: { slug?: string } } } }>
  }
  const task = parsed.tasks.find((entry) => entry.kind === 'recipe')
  expect(task, 'recipe-probe materializes at least one recipe task').toBeDefined()
  if (!task) throw new Error('no recipe task')
  const recipe = task.metadata?.runner?.recipe?.slug
  expect(recipe, `${task.id} carries a recipe slug`).toBeTruthy()
  return { cwd, taskId: task.id, recipe: recipe as string }
}

describe('waypoint tasks command', () => {
  it('lists materialized tasks for a route', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', '--route-id', 'route-001'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Tasks')
    expect(output).toContain('total: 12')
    expect(output).toContain('- task-003 discuss-objective')
    expect(output).toContain('  kind: discussion')
    expect(output).toContain('  agent: scaffold-discussion')
  })

  it('can emit tasks as JSON', async () => {
    const cwd = await startedProject()
    const { io, stdout } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', '--json'], io)).toBe(0)
    const parsed = JSON.parse(stdout.join('\n')) as { tasks: Array<{ id: string; route_id: string }> }
    expect(parsed.tasks).toHaveLength(12)
    expect(parsed.tasks[0]).toMatchObject({ id: 'task-001', route_id: 'route-001' })
  })

  it('shows one task with its contract (non-durable backend: no attempt surface)', async () => {
    const { cwd, taskId, recipe } = await startedRecipeProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', 'show', taskId], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain(`Task ${taskId} (`)
    expect(output).toContain('kind: recipe')
    expect(output).toContain(`recipe: ${recipe}`)
    // Plain (non-durable) postgres has no dispatch rows: no attempt line, no report hint.
    expect(output).not.toContain('attempt:')
    expect(output).not.toContain('waypoint tasks report')
  })

  it('show emits JSON with the task, recipe, and artifacts', async () => {
    const { cwd, taskId, recipe } = await startedRecipeProject()
    const { io, stdout } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', 'show', taskId, '--json'], io)).toBe(0)
    const parsed = JSON.parse(stdout.join('\n')) as { task: { id: string }; recipe: string | null; attempt: unknown }
    expect(parsed.task.id).toBe(taskId)
    expect(parsed.recipe).toBe(recipe)
    expect(parsed.attempt).toBeNull()
  })

  it('show and report refuse gracefully on unknown tasks / non-durable backends', async () => {
    const cwd = await startedProject()
    const missing = makeIo(cwd)
    expect(await runWaypointCli(['tasks', 'show', 'task-999'], missing.io)).toBe(1)
    expect(missing.stderr.join('\n')).toContain('No task found with id task-999')

    const report = makeIo(cwd)
    expect(
      await runWaypointCli(['tasks', 'report', 'task-004', '--status', 'finished', '--summary', 'did it'], report.io),
    ).toBe(1)
    expect(report.stderr.join('\n')).toContain('requires a durable postgres run')

    const badUsage = makeIo(cwd)
    expect(await runWaypointCli(['tasks', 'report', 'task-004', '--status', 'bogus', '--summary', 'x'], badUsage.io)).toBe(1)
    expect(badUsage.stderr.join('\n')).toContain('usage: waypoint tasks report')
  })
})
