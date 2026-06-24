import { describe, expect, it, vi } from 'vitest'

// Isolated in its own file: mock node:fs/promises so the FIRST readFile during a
// load rejects once, simulating a transient FS error. Everything else stays real.
const state = vi.hoisted(() => ({ failNextReadFile: false }))

vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (state.failNextReadFile) {
        state.failNextReadFile = false
        throw new Error('transient read error')
      }
      return actual.readFile(...args)
    },
  }
})

import { clearBundledWaypointCatalogCache, loadBundledWaypointCatalog } from './bundled.ts'

describe('bundled catalog cache — failed load is not cached (waypoint-7ok N5)', () => {
  it('does not cache a failed load; the next call retries and succeeds', async () => {
    clearBundledWaypointCatalogCache()

    // First load: a transient readFile failure is collected → strict load throws.
    state.failNextReadFile = true
    await expect(loadBundledWaypointCatalog()).rejects.toThrow()

    // The failed promise must NOT have been cached: the next call re-loads cleanly.
    const catalog = await loadBundledWaypointCatalog()
    expect(catalog.quests.has('waypoint')).toBe(true)

    clearBundledWaypointCatalogCache()
  })
})
