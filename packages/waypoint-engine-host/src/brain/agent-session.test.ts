import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventHub } from '../core/event-hub.ts'
import type { AgentEventRecord, EngineEvent } from '../types.ts'
import { FakeBrainAdapter } from './fake-adapter.ts'
import { AgentRegistry } from './agent-registry.ts'

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-agent-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  return root
}

describe('AgentSession', () => {
  it('republishes on agent:<id>, records a transcript with idx+seq, and fires onTerminal', async () => {
    const hub = new EventHub()
    const root = await tmpRoot()
    const seen: EngineEvent[] = []
    let terminal = ''
    hub.subscribe({ topics: '*', deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    const registry = new AgentRegistry()
    const session = registry.create({
      id: 'sess-1',
      intent: 'build demo',
      tools: ['author.recipe'],
      systemPrompt: 'sp',
      adapter: new FakeBrainAdapter({
        events: [{ kind: 'agent.message', at: '2026-06-18T00:00:00Z', data: { text: 'hi' } }],
        result: { status: 'completed', summary: 'ok' },
      }),
      hub,
      root,
      onTerminal: (r) => {
        terminal = r.status
      },
      now: () => '2026-06-18T00:00:00Z',
    })

    const result = await session.run()
    expect(result.status).toBe('completed')
    expect(terminal).toBe('completed')
    expect(seen.map((e) => e.topic)).toEqual(['agent:sess-1'])
    expect((seen[0].record as AgentEventRecord).kind).toBe('agent.message')
    expect(session.transcript().map((e) => e.kind)).toEqual(['agent.message'])

    const written = await readFile(join(root, '.waypoint', 'agent', 'sess-1.jsonl'), 'utf8')
    const rec = JSON.parse(written.trim()) as { idx: number; seq: number; kind: string }
    expect(rec.kind).toBe('agent.message')
    expect(rec.idx).toBe(0)
    expect(typeof rec.seq).toBe('number')
  })

  it('cancel() aborts the run and reports cancelled in the registry', async () => {
    const hub = new EventHub()
    const root = await tmpRoot()
    const registry = new AgentRegistry()
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    const session = registry.create({
      id: 'sess-2',
      intent: 'x',
      tools: [],
      systemPrompt: '',
      adapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' }, gate }),
      hub,
      root,
    })
    const p = session.run()
    session.cancel()
    release()
    expect((await p).status).toBe('cancelled')
    expect(registry.list().find((s) => s.id === 'sess-2')?.status).toBe('cancelled')
  })

  it('cancelAll cancels every live session', async () => {
    const hub = new EventHub()
    const root = await tmpRoot()
    const registry = new AgentRegistry()
    const gate = new Promise<void>(() => {}) // never resolves
    const s = registry.create({
      id: 'sess-3',
      intent: 'x',
      tools: [],
      systemPrompt: '',
      adapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' }, gate }),
      hub,
      root,
    })
    const p = s.run()
    registry.cancelAll()
    expect((await p).status).toBe('cancelled')
  })
})
