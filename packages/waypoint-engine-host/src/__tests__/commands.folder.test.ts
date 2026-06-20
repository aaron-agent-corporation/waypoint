import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host commands (folder)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('opens a workspace and reports status', async () => {
    const opened = await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    expect(opened).toMatchObject({ ok: true, action: 'workspace.open', workspace: { backend: 'folder' } })
    const status = await host.dispatch('workspace.status', {})
    expect(status).toMatchObject({ ok: true, action: 'workspace.status', status: { initialized: true } })
  })

  it('lists the bundled quest catalog as an array', async () => {
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    const quests = (await host.dispatch('catalog.quests', {})) as unknown as { ok: boolean; quests: unknown[] }
    expect(quests.ok).toBe(true)
    expect(Array.isArray(quests.quests)).toBe(true)
    expect(quests.quests.length).toBeGreaterThan(0)
  })

  it('lists recipes, and recipes for a specific quest', async () => {
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    const all = (await host.dispatch('catalog.recipes', {})) as unknown as { ok: boolean; recipes: unknown[] }
    expect(all.ok).toBe(true)
    expect(Array.isArray(all.recipes)).toBe(true)
    const forQuest = (await host.dispatch('catalog.recipes', { quest: 'waypoint' })) as unknown as {
      ok: boolean
      recipes: unknown[]
    }
    expect(forQuest.ok).toBe(true)
    expect(Array.isArray(forQuest.recipes)).toBe(true)
  })

  it('errors with NO_WORKSPACE when no workspace is open', async () => {
    expect(await host.dispatch('catalog.quests', {})).toEqual({
      ok: false,
      action: 'error',
      error: 'No workspace open; call workspace.open first',
      details: { code: 'NO_WORKSPACE', message: 'No workspace open; call workspace.open first' },
    })
  })

  it('errors with NOT_FOUND for an unknown quest', async () => {
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    expect(await host.dispatch('catalog.recipes', { quest: 'does-not-exist' })).toMatchObject({
      ok: false,
      action: 'error',
      details: { code: 'NOT_FOUND' },
    })
  })
})
