import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

import { sessionsPlugin } from './index.ts'
import type { CordisSessionEvent } from './index.ts'

/**
 * The sessions service's two mutation seams. `compact` is the boundary cut;
 * `rewriteToolResult` is the pruner's narrow in-place mutation (Phase C):
 * it may only touch a tool_result's output, must hand back the verbatim
 * original for the caller's recall archive, and must refuse anything else —
 * a pruner that could rewrite user text would be an authoring surface.
 */
describe('sessions.rewriteToolResult — the pruner seam', () => {
  const call = { id: 'call-1', name: 'list_cases', args: {} }

  async function sessionsCtx(events: CordisSessionEvent[]): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(sessionsPlugin)
    for (const event of events) ctx.sessions.append(event)
    return ctx
  }

  it('replaces only the output and returns the verbatim original', async () => {
    const original: CordisSessionEvent = {
      type: 'tool_result',
      call,
      outcome: { status: 'ok', output: 'x'.repeat(5000) },
    }
    const ctx = await sessionsCtx([{ type: 'user', text: 'hi' }, { type: 'tool_call', call }, original])

    const returned = ctx.sessions.rewriteToolResult(2, 'pruned')

    expect(returned).toBe(original)
    const now = ctx.sessions.all()[2]!
    expect(now.type).toBe('tool_result')
    if (now.type === 'tool_result') {
      expect(now.outcome.output).toBe('pruned')
      expect(now.outcome.status).toBe('ok')
      expect(now.call).toBe(call)
    }
    expect(ctx.sessions.all()).toHaveLength(3)
  })

  it('refuses an index that does not hold a tool_result', async () => {
    const ctx = await sessionsCtx([{ type: 'user', text: 'hi' }])
    expect(() => ctx.sessions.rewriteToolResult(0, 'nope')).toThrow(/holds a 'user' event/)
  })

  it('refuses an out-of-range index', async () => {
    const ctx = await sessionsCtx([{ type: 'user', text: 'hi' }])
    expect(() => ctx.sessions.rewriteToolResult(7, 'nope')).toThrow(/out of range/)
  })
})
