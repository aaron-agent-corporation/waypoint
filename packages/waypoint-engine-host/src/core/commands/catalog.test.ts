import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../engine-host.ts'
import { cleanup } from '../../__tests__/helpers/workspace.ts'

async function openHost() {
  const root = await mkdtemp(join(tmpdir(), 'wp-catalog-cmd-'))
  const host = createEngineHost()
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

describe('catalog.install command', () => {
  let root: string
  let host: ReturnType<typeof createEngineHost>

  beforeEach(async () => {
    ;({ host, root } = await openHost())
  })

  afterEach(async () => {
    await cleanup(root)
  })

  it('catalog.install installs a bundled quest and returns the full envelope', async () => {
    const res = await host.dispatch('catalog.install', { quest: 'waypoint' }) as Record<string, unknown>
    expect(res.ok).toBe(true)
    const r = res as { ok: true; quest: { slug: string }; recipes: unknown; installedQuestPaths: string[]; installedRecipePaths: string[] }
    expect(r.quest.slug).toBe('waypoint')
    expect(Array.isArray(r.installedQuestPaths)).toBe(true)
    expect(Array.isArray(r.installedRecipePaths)).toBe(true)
    // the quest manifest now exists locally
    const installed = await readFile(join(root, '.waypoint/quests/waypoint.yaml'), 'utf8')
    expect(installed).toContain('slug: waypoint')
  })

  it('catalog.install rejects a missing quest slug with VALIDATION', async () => {
    const res = await host.dispatch('catalog.install', {}) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string; path?: string }).code).toBe('VALIDATION')
    expect((res.details as { code: string; path?: string }).path).toBe('quest')
  })

  it('catalog.install surfaces NOT_FOUND for an unknown quest', async () => {
    const res = await host.dispatch('catalog.install', { quest: 'no-such-quest-xyz' }) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('NOT_FOUND')
  })

  it('catalog.install is workspace-wins: an authored quest manifest is byte-identical after re-install', async () => {
    await host.dispatch('catalog.install', { quest: 'waypoint' })
    const path = join(root, '.waypoint/quests/waypoint.yaml')
    const authored = (await readFile(path, 'utf8')) + '\n# operator edit\n'
    await writeFile(path, authored, 'utf8')
    await host.dispatch('catalog.install', { quest: 'waypoint' }) // re-install
    expect(await readFile(path, 'utf8')).toBe(authored) // preserved, not clobbered
  })
})
