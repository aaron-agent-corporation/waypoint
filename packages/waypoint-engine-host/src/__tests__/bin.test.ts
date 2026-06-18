import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineClient } from '../client.ts'
import { startEngineHostFromEnv, type EngineHostHandle } from '../bin.ts'
import { cleanup, delay, makeTempDir } from './helpers/workspace.ts'

describe('engine-host launcher + client', () => {
  let dir: string
  let handle: EngineHostHandle | null = null
  beforeEach(async () => {
    dir = await makeTempDir()
  })
  afterEach(async () => {
    if (handle) await handle.stop()
    handle = null
    await cleanup(dir)
  })

  it('boots, opens the configured root, and writes a 0600 handshake', async () => {
    const handshake = join(dir, 'handshake.json')
    handle = await startEngineHostFromEnv([], {
      WAYPOINT_ENGINE_ROOT: dir,
      WAYPOINT_ENGINE_BACKEND: 'folder',
      WAYPOINT_ENGINE_HANDSHAKE: handshake,
    })
    const info = JSON.parse(await readFile(handshake, 'utf8')) as {
      port: number
      token: string
      url: string
      pid: number
      schemaVersion: number
      workspaceRoot: string
    }
    expect(info.port).toBeGreaterThan(0)
    expect(typeof info.token).toBe('string')
    expect(info.pid).toBe(process.pid)
    expect(info.workspaceRoot).toBe(dir)
    expect(info.schemaVersion).toBe(1)
    const mode = (await stat(handshake)).mode & 0o777
    expect(mode).toBe(0o600)

    const res = await fetch(`${info.url}/cmd/workspace.status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}` },
    })
    expect(await res.json()).toMatchObject({ ok: true, action: 'workspace.status', status: { initialized: true } })
  })

  it('the shipped client round-trips a command and receives a WS event', async () => {
    handle = await startEngineHostFromEnv([], { WAYPOINT_ENGINE_ROOT: dir, WAYPOINT_ENGINE_BACKEND: 'folder' })
    const client = createEngineClient({ url: handle.url, token: handle.token })

    const status = await client.cmd('workspace.status')
    expect(status).toMatchObject({ ok: true, status: { initialized: true } })

    const events: unknown[] = []
    const unsubscribe = await client.subscribe(['*'], (e) => events.push(e))
    await client.cmd('run.start', { quest: 'waypoint' })
    for (let i = 0; i < 50 && events.length === 0; i += 1) await delay(20)
    unsubscribe()
    expect(events.length).toBeGreaterThan(0)
  })
})
