import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Force the no-project (bundled) path and make the bundled load throw a controllable
// error, simulating a load failure reaching the CLI via strict loading (waypoint-bae #4 / sga F4).
const state = vi.hoisted(() => ({ thrown: null as Error | null }))

vi.mock('@waypoint/folder-host', async (orig) => {
  const actual = await orig<typeof import('@waypoint/folder-host')>()
  return {
    ...actual,
    findWaypointProjectRoot: async () => null,
    loadBundledWaypointCatalog: async () => {
      throw state.thrown ?? new Error('unexpected')
    },
  }
})

import { CatalogLoadError } from '@waypoint/folder-host'

import { runQuestsCommand } from './quests.ts'
import { runRecipesCommand } from './recipes.ts'

describe('CLI surfaces a clean error when the catalog fails to load', () => {
  const createdDirs: string[] = []

  beforeEach(() => {
    // Default: an EXPECTED corrupt-catalog failure (clean one-line message, no stack).
    state.thrown = new CatalogLoadError('Recipe', 'recipes/broken.yaml', 'invalid Recipe manifest')
  })

  afterEach(async () => {
    state.thrown = null
    while (createdDirs.length > 0) {
      await rm(createdDirs.pop()!, { recursive: true, force: true })
    }
  })

  async function noProjectCwd(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'wp-noproj-'))
    createdDirs.push(dir)
    return dir
  }

  it('quests returns 1 with a clean stderr message and no stack for an expected catalog failure', async () => {
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the Waypoint catalog: invalid Recipe manifest/)
    expect(err.join('\n')).not.toMatch(/\n\s*at /) // no stack trace for an expected failure
  })

  it('recipes returns 1 with a clean stderr message for an expected catalog failure', async () => {
    const err: string[] = []
    const code = await runRecipesCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the Waypoint catalog/)
  })

  it('preserves the stack for an UNEXPECTED internal error so a real bug is not masked', async () => {
    state.thrown = new Error('overlay merge blew up')

    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    const out = err.join('\n')
    expect(out).toMatch(/Failed to load the Waypoint catalog: overlay merge blew up/)
    expect(out).toMatch(/\bat /) // an unexpected error keeps its stack frames
  })
})
