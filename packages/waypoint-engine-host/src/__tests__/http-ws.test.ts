import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host HTTP transport', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  let started: { port: number; token: string; url: string }
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    started = await host.start()
  })
  afterEach(async () => {
    await host.stop()
    await cleanup(dir)
  })

  it('binds loopback on an ephemeral port with a token', () => {
    expect(started.port).toBeGreaterThan(0)
    expect(started.token).toMatch(/^[a-f0-9]{32,}$/)
    expect(started.url).toContain('127.0.0.1')
  })

  it('rejects requests without the bearer token', async () => {
    const res = await fetch(`${started.url}/cmd/workspace.status`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('dispatches a command over HTTP with the token', async () => {
    const res = await fetch(`${started.url}/cmd/workspace.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ root: dir, backend: 'folder' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, action: 'workspace.open' })
  })

  it('returns the coded error envelope for an unknown command', async () => {
    const res = await fetch(`${started.url}/cmd/nope`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}` },
    })
    expect(await res.json()).toMatchObject({
      ok: false,
      action: 'error',
      error: 'Unknown command: nope',
      details: { code: 'UNKNOWN_COMMAND' },
    })
  })

  it('rejects an oversized request body with 413', async () => {
    const big = 'x'.repeat(1_100_000)
    const res = await fetch(`${started.url}/cmd/workspace.status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ big }),
    })
    expect(res.status).toBe(413)
  })

  it('returns 400 with VALIDATION on malformed JSON', async () => {
    const res = await fetch(`${started.url}/cmd/workspace.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
      body: '{ not json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, details: { code: 'VALIDATION' } })
  })

  it('streams a snapshot then live deltas over WebSocket', async () => {
    await fetch(`${started.url}/cmd/workspace.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ root: dir, backend: 'folder' }),
    })
    const wsUrl = `${started.url.replace('http', 'ws')}/ws`
    const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${started.token}` } })
    const messages: Array<{ type: string; apiVersion?: string }> = []
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ subscribe: { topics: ['*'] } })))
      socket.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; apiVersion?: string }
        messages.push(msg)
        if (msg.type === 'snapshot') {
          void fetch(`${started.url}/cmd/run.start`, {
            method: 'POST',
            headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ quest: 'waypoint' }),
          })
        }
        if (msg.type === 'event') resolve()
      })
      socket.on('error', reject)
    })
    socket.close()
    expect(messages[0].type).toBe('snapshot')
    expect(messages[0].apiVersion).toBe('1')
    expect(messages.some((m) => m.type === 'event')).toBe(true)
  })

  it('rejects a WebSocket handshake without a valid token', async () => {
    const socket = new WebSocket(`${started.url.replace('http', 'ws')}/ws`, {
      headers: { authorization: 'Bearer wrong' },
    })
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve())
      socket.on('error', () => resolve())
    })
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })
})
