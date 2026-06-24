import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// Force the no-project (bundled) path and make the bundled load fail, simulating a
// corrupt bundled manifest reaching the CLI via strict loading (waypoint-bae #4).
vi.mock('@waypoint/folder-host', async (orig) => {
  const actual = await orig<typeof import('@waypoint/folder-host')>()
  return {
    ...actual,
    findWaypointProjectRoot: async () => null,
    loadBundledWaypointCatalog: async () => {
      throw new Error('bundled catalog is corrupt')
    },
  }
})

import { runQuestsCommand } from './quests.ts'
import { runRecipesCommand } from './recipes.ts'

describe('CLI surfaces a clean error when the catalog fails to load', () => {
  async function noProjectCwd(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'wp-noproj-'))
  }

  it('quests returns 1 with a stderr message, not an unhandled rejection', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the Waypoint catalog: bundled catalog is corrupt/)
  })

  it('recipes returns 1 with a stderr message, not an unhandled rejection', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runRecipesCommand([], { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the Waypoint catalog/)
  })
})
