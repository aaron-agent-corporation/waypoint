import { describe, expect, it, vi } from 'vitest'

import { createBrowserEngineClient } from './client'
import type { EngineWsMessage } from './types'

describe('createBrowserEngineClient.cmd', () => {
  it('POSTs same-origin /cmd/<name> with JSON and returns the envelope', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ ok: true, action: 'routes.list', routes: [] }) }) as unknown as Response)
    const client = createBrowserEngineClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl })
    const res = await client.cmd('routes.list', { routeId: 'r1' })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9/cmd/routes.list', expect.objectContaining({ method: 'POST' }))
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ routeId: 'r1' })
    expect(res).toEqual({ ok: true, action: 'routes.list', routes: [] })
  })
})

describe('createBrowserEngineClient.subscribe', () => {
  it('opens a WS, sends a subscribe frame on open, and forwards parsed messages', () => {
    const sent: string[] = []
    const fake = { onopen: null as null | (() => void), onmessage: null as null | ((e: { data: unknown }) => void), onclose: null, onerror: null, send: (d: string) => sent.push(d), close: vi.fn() }
    const received: EngineWsMessage[] = []
    const client = createBrowserEngineClient({ baseUrl: 'http://127.0.0.1:9', wsFactory: () => fake })
    const unsub = client.subscribe(['*'], (m) => received.push(m))
    fake.onopen?.()
    expect(JSON.parse(sent[0])).toEqual({ subscribe: { topics: ['*'] } })
    fake.onmessage?.({ data: JSON.stringify({ type: 'resnapshot' }) })
    expect(received).toEqual([{ type: 'resnapshot' }])
    unsub()
    expect(fake.close).toHaveBeenCalled()
  })

  function captureWsUrl(baseUrl: string): string {
    let captured = ''
    const fake = { onopen: null, onmessage: null, onclose: null, onerror: null, send: vi.fn(), close: vi.fn() }
    const client = createBrowserEngineClient({
      baseUrl,
      wsFactory: (url) => {
        captured = url
        return fake
      },
    })
    client.subscribe(['*'], () => {})
    return captured
  }

  // Contract: the socket connects under the SAME path prefix as `cmd()` (which
  // posts to `${baseUrl}/cmd/...`), with the scheme swapped to ws/wss.
  it('maps an origin-only baseUrl to <origin>/ws', () => {
    expect(captureWsUrl('http://127.0.0.1:9')).toBe('ws://127.0.0.1:9/ws')
    expect(captureWsUrl('https://example.com')).toBe('wss://example.com/ws')
  })

  it('preserves a path-bearing baseUrl prefix (same prefix cmd posts under)', () => {
    expect(captureWsUrl('http://host:8080/prefix')).toBe('ws://host:8080/prefix/ws')
    expect(captureWsUrl('https://host/a/b/')).toBe('wss://host/a/b/ws')
  })
})
