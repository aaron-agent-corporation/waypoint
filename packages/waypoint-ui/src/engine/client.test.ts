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
})
