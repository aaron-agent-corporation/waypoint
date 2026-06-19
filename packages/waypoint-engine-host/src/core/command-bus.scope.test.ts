import { describe, expect, it } from 'vitest'

import { CommandBus } from './command-bus.ts'

describe('CommandBus scope enforcement', () => {
  it('rejects out-of-scope commands with FORBIDDEN before the handler runs', async () => {
    const bus = new CommandBus()
    let ran = false
    bus.register('author.approveProposal', () => {
      ran = true
      return { ok: true, action: 'author.approveProposal' }
    })
    const res = await bus.dispatch('author.approveProposal', {}, { allow: new Set(['author.recipe']) })
    expect(res.ok).toBe(false)
    expect((res as { details: { code: string } }).details.code).toBe('FORBIDDEN')
    expect(ran).toBe(false)
  })

  it('allows in-scope commands and is unrestricted when no allow-set is given', async () => {
    const bus = new CommandBus()
    bus.register('author.recipe', () => ({ ok: true, action: 'author.recipe' }))
    expect((await bus.dispatch('author.recipe', {}, { allow: new Set(['author.recipe']) })).ok).toBe(true)
    expect((await bus.dispatch('author.recipe', {})).ok).toBe(true)
  })

  it('passes the dispatch context through to the handler', async () => {
    const bus = new CommandBus()
    let seenSession: string | undefined
    bus.register('run.adhoc', (_payload, ctx) => {
      seenSession = ctx?.agentSessionId
      return { ok: true, action: 'run.adhoc' }
    })
    await bus.dispatch('run.adhoc', {}, { allow: new Set(['run.adhoc']), agentSessionId: 'agent-007' })
    expect(seenSession).toBe('agent-007')
  })
})
