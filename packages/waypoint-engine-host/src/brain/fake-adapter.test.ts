import { describe, expect, it } from 'vitest'

import { FakeBrainAdapter } from './fake-adapter.ts'

describe('FakeBrainAdapter', () => {
  it('emits scripted events in order then returns the scripted result', async () => {
    const a = new FakeBrainAdapter({
      events: [
        { kind: 'agent.start', at: '2026-06-18T00:00:00Z' },
        { kind: 'agent.message', at: '2026-06-18T00:00:01Z', data: { text: 'drafting' } },
      ],
      result: { status: 'completed', summary: 'done', proposalId: 'recipe/demo' },
    })
    const seen: string[] = []
    const result = await a.runSession({
      intent: 'build a demo recipe',
      tools: ['author.recipe'],
      systemPrompt: 'sp',
      onEvent: (e) => seen.push(e.kind),
    })
    expect(seen).toEqual(['agent.start', 'agent.message'])
    expect(result).toEqual({ status: 'completed', summary: 'done', proposalId: 'recipe/demo' })
  })

  it('returns cancelled when the signal aborts before the gate resolves', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    const ctrl = new AbortController()
    const a = new FakeBrainAdapter({ events: [{ kind: 'agent.message', at: 't' }], result: { status: 'completed' }, gate })
    const p = a.runSession({ intent: 'x', tools: [], systemPrompt: '', signal: ctrl.signal, onEvent: () => {} })
    ctrl.abort()
    release()
    expect((await p).status).toBe('cancelled')
  })

  it('stops emitting early when aborted mid-stream via onBeforeEmit', async () => {
    const ctrl = new AbortController()
    const seen: string[] = []
    const a = new FakeBrainAdapter({
      events: [
        { kind: 'a', at: 't' },
        { kind: 'b', at: 't' },
      ],
      result: { status: 'completed' },
      onBeforeEmit: () => ctrl.abort(),
    })
    const r = await a.runSession({ intent: 'x', tools: [], systemPrompt: '', signal: ctrl.signal, onEvent: (e) => seen.push(e.kind) })
    expect(seen).toEqual([])
    expect(r.status).toBe('cancelled')
  })

  it('acts as its own factory (forSession returns an adapter)', async () => {
    const a = new FakeBrainAdapter({ events: [], result: { status: 'completed' } })
    const scoped = a.forSession({ hostUrl: 'http://127.0.0.1:1/', hostToken: 't' })
    expect((await scoped.runSession({ intent: 'x', tools: [], systemPrompt: '', onEvent: () => {} })).status).toBe('completed')
  })
})
