import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocket as NodeWebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createEngineHost, FakeBrainAdapter } from '@waypoint/engine-host'
import { createBrowserEngineClient, type WebSocketLike } from './client'
import type { EngineWsMessage } from './types'

let host: ReturnType<typeof createEngineHost>
let url = ''
let token = ''

beforeAll(async () => {
  host = createEngineHost({ brainAdapter: new FakeBrainAdapter({ events: [{ kind: 'text', at: new Date().toISOString(), data: { text: 'hello' } }], result: { status: 'completed', proposalId: 'recipe/demo' } }) })
  const started = await host.start()
  url = started.url
  token = started.token
})
afterAll(async () => { await host.stop() })

async function waitUntil(predicate: () => boolean, { timeout = 2000, interval = 25 } = {}): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitUntil timed out')
    await new Promise((r) => setTimeout(r, interval))
  }
}

function nodeClient() {
  const headers = { authorization: `Bearer ${token}` }
  return createBrowserEngineClient({
    baseUrl: url,
    headers,
    fetchImpl: fetch,
    wsFactory: (wsUrl) => new NodeWebSocket(wsUrl, { headers }) as unknown as WebSocketLike,
  })
}

describe('browser client against a real engine host', () => {
  it('cmd round-trips workspace.open + meta.health', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-ui-it-'))
    const client = nodeClient()
    const open = await client.cmd('workspace.open', { root, backend: 'folder' })
    expect(open.ok).toBe(true)
    const health = (await client.cmd('meta.health')) as Record<string, unknown>
    expect(health.brain).toBe('fake')
  })

  it('subscribe delivers a snapshot then live events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-ui-it2-'))
    const client = nodeClient()
    await client.cmd('workspace.open', { root, backend: 'folder' })

    const messages: EngineWsMessage[] = []
    const unsub = client.subscribe(['*'], (m) => messages.push(m))
    await waitUntil(() => messages.some((m) => m.type === 'snapshot'))
    expect(messages.find((m) => m.type === 'snapshot')).toBeTruthy()

    await client.cmd('agent.run', { intent: 'demo' })
    await waitUntil(() => messages.some((m) => m.type === 'event' && m.topic.startsWith('agent:')))
    expect(messages.some((m) => m.type === 'event' && m.topic.startsWith('agent:'))).toBe(true)
    unsub()
  })
})
