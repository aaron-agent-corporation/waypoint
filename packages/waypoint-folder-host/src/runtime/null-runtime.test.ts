import { describe, expect, it } from 'vitest'

import { NullRecipeRuntime, UnconfiguredRecipeRuntime } from './null-runtime.ts'

describe('NullRecipeRuntime', () => {
  it('simulates recipe execution without invoking external commands', async () => {
    const runtime = new NullRecipeRuntime()

    await expect(
      runtime.runRecipe({
        routeId: 'route-001',
        taskId: 'task-001',
        recipe: 'runner-doc-writer',
        projectRoot: '/tmp/project',
      }),
    ).resolves.toEqual({
      status: 'simulated',
      runtime: 'null',
      recipe: 'runner-doc-writer',
      task_id: 'task-001',
      route_id: 'route-001',
    })
  })
})

describe('UnconfiguredRecipeRuntime (Q1, docs/designs/q-quest-proving.md)', () => {
  it('refuses to run a recipe — unset runtime.recipe must never mean silent simulation', async () => {
    const runtime = new UnconfiguredRecipeRuntime()

    await expect(
      runtime.runRecipe({
        routeId: 'route-001',
        taskId: 'task-001',
        recipe: 'runner-doc-writer',
        projectRoot: '/tmp/project',
      }),
    ).rejects.toThrow(/runtime\.recipe is not configured/)
  })

  it('is a NullRecipeRuntime subclass so manifest-skip checks treat it alike', () => {
    expect(new UnconfiguredRecipeRuntime()).toBeInstanceOf(NullRecipeRuntime)
  })
})
