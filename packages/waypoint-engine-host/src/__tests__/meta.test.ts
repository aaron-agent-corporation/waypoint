import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host meta commands', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('meta.commands lists the registered command surface', async () => {
    const res = (await host.dispatch('meta.commands', {})) as unknown as { ok: boolean; commands: string[] }
    expect(res.ok).toBe(true)
    expect(res.commands).toEqual([...res.commands].sort())
    expect(res.commands).toEqual(expect.arrayContaining(['workspace.open', 'catalog.quests', 'meta.health']))
  })

  it('meta.health reports workspace + seq (no workspace open)', async () => {
    const res = (await host.dispatch('meta.health', {})) as unknown as {
      ok: boolean
      action: string
      workspaceOpen: boolean
      seq: number
      uptime: number
    }
    expect(res).toMatchObject({ ok: true, action: 'meta.health', workspaceOpen: false, seq: 0 })
    expect(typeof res.uptime).toBe('number')
  })

  it('meta.health reflects an open workspace', async () => {
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    expect(await host.dispatch('meta.health', {})).toMatchObject({ ok: true, workspaceOpen: true })
  })

  it('meta.version reports apiVersion and package version', async () => {
    expect(await host.dispatch('meta.version', {})).toMatchObject({
      ok: true,
      action: 'meta.version',
      apiVersion: '1',
      pkg: '0.1.2',
    })
  })
})
