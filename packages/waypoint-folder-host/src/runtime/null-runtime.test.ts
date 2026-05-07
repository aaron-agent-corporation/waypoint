import { describe, expect, it } from 'vitest'

import { NullRecipeRuntime } from './null-runtime.ts'

describe('NullRecipeRuntime', () => {
  it('simulates recipe execution without invoking external commands', async () => {
    const runtime = new NullRecipeRuntime()

    await expect(
      runtime.runRecipe({
        routeId: 'route-001',
        taskId: 'task-001',
        recipe: 'waypoint-doc-writer',
        projectRoot: '/tmp/project',
      }),
    ).resolves.toEqual({
      status: 'simulated',
      runtime: 'null',
      recipe: 'waypoint-doc-writer',
      task_id: 'task-001',
      route_id: 'route-001',
    })
  })
})
