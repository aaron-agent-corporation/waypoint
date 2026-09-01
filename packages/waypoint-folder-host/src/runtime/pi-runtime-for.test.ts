// Item 53: the pi runtime is retired for workers (cordis-only). These are the
// retired path's own tests — run under the documented escape, never in product.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { piRecipeRuntimeFor } from './pi-runtime-for.ts'

/**
 * The shared builder + the bridge/autopilot fork, proven WITHOUT credentials:
 * model routing (rsc-bpg) is step 1 of the run, before any auth resolution, so
 * an unconfigured project fails closed here without ever touching the pi auth
 * store. The real-model path is proven in real-turn-spike.mjs.
 */

const savedConfigHome = process.env.WAYPOINT_CONFIG_HOME

afterEach(() => {
  if (savedConfigHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
  else process.env.WAYPOINT_CONFIG_HOME = savedConfigHome
})

async function emptyConfigHome(): Promise<string> {
  // An empty config home => loadProviderRegistry sees no providers.
  const home = await mkdtemp(join(tmpdir(), 'pi-cfg-home-'))
  process.env.WAYPOINT_CONFIG_HOME = home
  return home
}

describe('piRecipeRuntimeFor — the builder + fork, fail-closed without credentials (rsc-tka)', () => {
  it('fails closed when the project configures no model target (no auth touched)', async () => {
    await emptyConfigHome()
    const projectRoot = await mkdtemp(join(tmpdir(), 'pi-proj-'))
    const runtime = await piRecipeRuntimeFor(projectRoot)
    const out = await runtime.runRecipe({
      routeId: 'route-1',
      taskId: 'task-1',
      recipe: 'pi-demo',
      prompt: 'do the thing',
      projectRoot,
      modelClass: 'high',
    })
    expect(out.status).toBe('failed')
    expect(out.runtime).toBe('pi')
    expect(out.close_reason).toContain('model routing failed')
  })
})
