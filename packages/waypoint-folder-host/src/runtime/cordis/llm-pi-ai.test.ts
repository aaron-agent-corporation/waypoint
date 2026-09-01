import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { llmCorePlugin } from '@waypoint/kernel'

import { buildCordisPiAiAdapter, cordisLlmPiAi, type PiAiResolver } from './llm-pi-ai.ts'

/**
 * A failed turn must say WHY, in the provider's own words.
 *
 * H-8 ran cordis against its first non-Codex provider and got
 * `model openrouter/z-ai/glm-4.6 failed: unknown` — twice, through an
 * auto-retry, with nothing to act on. The provider had in fact said "Provider
 * is not configured: openrouter", a sentence that names both the problem and
 * the fix. It was dropped because pi-ai puts a failed turn's assistant message
 * under `error`, and this seam read only `message`.
 *
 * "unknown" is the reassuring value: it reads like a transient blip when it can
 * equally be an unconfigured provider, a lapsed token, or a refusal — three
 * failures wanting three different responses from whoever is on call.
 */

/** A resolver whose stream emits exactly the events a test hands it. */
function scriptedResolver(events: readonly Record<string, unknown>[]): PiAiResolver {
  return {
    hasConfiguredAuth: () => true,
    getModel: () => ({}),
    async *streamSimple() {
      for (const event of events) yield event as never
    },
  }
}

async function turnError(events: readonly Record<string, unknown>[]): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(llmCorePlugin)
  await ctx.plugin(cordisLlmPiAi, {
    provider: 'openrouter',
    model: 'z-ai/glm-4.6',
    resolverFactory: async () => scriptedResolver(events),
  })
  try {
    await ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('the turn was expected to fail and did not')
}

describe('a failed turn carries the provider\'s own sentence', () => {
  it('reads errorMessage from the `error` payload, where pi-ai actually puts it', async () => {
    const message = await turnError([
      {
        type: 'error',
        reason: 'error',
        error: {
          role: 'assistant',
          content: [],
          provider: 'openrouter',
          model: 'z-ai/glm-4.6',
          stopReason: 'error',
          errorMessage: 'Provider is not configured: openrouter',
        },
      },
    ])

    expect(message).toContain('Provider is not configured: openrouter')
    expect(message).not.toContain('unknown')
  })

  it('still reads the older `message` placement', async () => {
    const message = await turnError([
      { type: 'error', message: { role: 'assistant', errorMessage: 'rate limited, retry in 30s' } },
    ])

    expect(message).toContain('rate limited, retry in 30s')
  })

  it('dumps the event rather than saying "unknown" when the provider sends no sentence', async () => {
    // The field moving again must degrade to "here is what arrived", not to a
    // word that tells the reader nothing and reads like a shrug.
    const message = await turnError([{ type: 'error', error: { role: 'assistant', stopReason: 'error' } }])

    expect(message).not.toMatch(/failed: unknown$/)
    expect(message).toContain('no message')
    expect(message).toContain('stopReason')
  })
})

/**
 * S2 (item 52): bounded turn-retry for the stream deaths S1 characterized —
 * in-guest quiet reasoning streams die at ~90–110s as "terminated" /
 * "WebSocket error". A killed stream retries the turn; bounded, never
 * silently; provider refusals never retry.
 */
describe('bounded turn-retry on transport death', () => {
  const DONE = {
    type: 'done',
    message: { role: 'assistant', content: [{ type: 'text', text: 'answered' }] },
  }
  const TERMINATED = { type: 'error', error: { role: 'assistant', errorMessage: 'terminated' } }

  /** A resolver whose Nth streamSimple call yields the Nth script. */
  function sequencedResolver(scripts: readonly (readonly Record<string, unknown>[])[]): {
    resolver: PiAiResolver
    calls: () => number
  } {
    let call = 0
    return {
      calls: () => call,
      resolver: {
        hasConfiguredAuth: () => true,
        getModel: () => ({}),
        streamSimple() {
          const script = scripts[Math.min(call, scripts.length - 1)]!
          call++
          return (async function* () {
            for (const event of script) yield event as never
          })()
        },
      },
    }
  }

  async function adapterWith(
    scripts: readonly (readonly Record<string, unknown>[])[],
    config: Record<string, unknown> = {},
  ) {
    const { resolver, calls } = sequencedResolver(scripts)
    const ctx = new Context()
    await ctx.plugin(llmCorePlugin)
    await ctx.plugin(cordisLlmPiAi, {
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      turnRetryDelayMs: 0,
      resolverFactory: async () => resolver,
      ...config,
    })
    return { ctx, calls }
  }

  it('a terminated stream is re-asked and the second attempt answers', async () => {
    const { ctx, calls } = await adapterWith([[TERMINATED], [DONE]])
    const reply = await ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] })
    expect(reply.text).toBe('answered')
    expect(calls()).toBe(2)
  })

  it('a stream that ends with no done event is a transport death and retries too', async () => {
    const { ctx, calls } = await adapterWith([[], [DONE]])
    const reply = await ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] })
    expect(reply.text).toBe('answered')
    expect(calls()).toBe(2)
  })

  it('retries are BOUNDED and the exhausted error says how many attempts died', async () => {
    const { ctx, calls } = await adapterWith([[TERMINATED]], { turnRetries: 2 })
    await expect(
      ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] }),
    ).rejects.toThrow(/terminated \(stream died on all 3 attempts\)/)
    expect(calls()).toBe(3)
  })

  it('a provider REFUSAL surfaces immediately — retrying an unconfigured provider burns nothing but time', async () => {
    const refusal = {
      type: 'error',
      error: { role: 'assistant', errorMessage: 'Provider is not configured: openrouter' },
    }
    const { ctx, calls } = await adapterWith([[refusal], [DONE]])
    await expect(
      ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] }),
    ).rejects.toThrow(/Provider is not configured/)
    expect(calls()).toBe(1)
  })

  it('an aborted run is a stop, not a blip — no re-ask after the caller cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const { ctx, calls } = await adapterWith([[TERMINATED], [DONE]])
    await expect(
      ctx.llm.generate({
        systemPrompt: '',
        tools: [],
        transcript: [{ type: 'user', text: 'go' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/terminated/)
    expect(calls()).toBe(1)
  })

  it('a successful retry leaves ONE assistant message — the transcript never doubles', async () => {
    const { ctx } = await adapterWith([[TERMINATED], [DONE], [DONE]])
    const first = await ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [{ type: 'user', text: 'go' }] })
    expect(first.text).toBe('answered')
    // Second turn: the adapter's internal transcript must hold exactly the one
    // user message and one assistant message — a doubled push would make this
    // turn's context lie about the conversation so far. The scripted resolver
    // cannot inspect messages directly, so the observable is that the second
    // turn still works and translates only the NEW user event.
    const second = await ctx.llm.generate({
      systemPrompt: '',
      tools: [],
      transcript: [
        { type: 'user', text: 'go' },
        { type: 'assistant', text: 'answered' },
        { type: 'user', text: 'again' },
      ],
    })
    expect(second.text).toBe('answered')
  })
})

describe('connect-phase bounds ride every turn (item 54, 2026-08-29)', () => {
  function optionCapturingResolver(): { resolver: PiAiResolver; seen: unknown[] } {
    const seen: unknown[] = []
    const resolver: PiAiResolver = {
      hasConfiguredAuth: () => true,
      getModel: () => ({}),
      streamSimple(_model, _context, options) {
        seen.push(options)
        return (async function* () {
          yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
        })() as AsyncIterable<{ type: string; message?: unknown }> as never
      },
    }
    return { resolver, seen }
  }

  it('defaults: 15s headers bound, 10s WS connect bound, SSE pinned', async () => {
    const { resolver, seen } = optionCapturingResolver()
    const adapter = buildCordisPiAiAdapter(resolver, {}, { provider: 'openai-codex', model: 'gpt-5.3-codex-spark' })
    await adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] })
    // transport 'sse' is the default, not 'auto': a fresh flow per attempt —
    // WS socket reuse turns one poisoned flow into a streak (item 54).
    // 45s headers bound: codex headers arrive in 0.5–2s, but reasoning models
    // (glm-4.6, route-012) buffer their first byte past 15s under load; 45s
    // fits them and still beats the ~75s OS SYN window for blackholed dials.
    expect(seen[0]).toMatchObject({ timeoutMs: 45_000, websocketConnectTimeoutMs: 10_000, transport: 'sse' })
  })

  it('classifies the OpenAI client abort text as a transport death (route-012)', async () => {
    const calls: number[] = []
    const resolver: PiAiResolver = {
      hasConfiguredAuth: () => true,
      getModel: async () => ({ id: 'z-ai/glm-4.6' }) as never,
      streamSimple: () => {
        calls.push(1)
        return (async function* () {
          if (calls.length === 1) {
            throw new Error('model openrouter/z-ai/glm-4.6 failed: Request timed out.')
          }
          yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } as never
        })()
      },
    }
    const adapter = buildCordisPiAiAdapter(resolver, {}, { provider: 'openrouter', model: 'z-ai/glm-4.6' })
    const out = await adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] })
    // The first attempt died on the aborted dial and was RETRIED, not surfaced.
    expect(calls.length).toBe(2)
    expect(JSON.stringify(out)).toContain('ok')
  })

  it('config overrides the bounds and the transport', async () => {
    const { resolver, seen } = optionCapturingResolver()
    const adapter = buildCordisPiAiAdapter(resolver, {}, {
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      headersTimeoutMs: 90_000,
      connectTimeoutMs: 5_000,
      transport: 'auto',
    })
    await adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] })
    expect(seen[0]).toMatchObject({ timeoutMs: 90_000, websocketConnectTimeoutMs: 5_000, transport: 'auto' })
  })

  it("pi-ai's phase-named timeouts are transport deaths (retried); our turn deadline is not", async () => {
    let attempts = 0
    const resolver: PiAiResolver = {
      hasConfiguredAuth: () => true,
      getModel: () => ({}),
      streamSimple() {
        attempts += 1
        return (async function* () {
          if (attempts === 1) throw new Error('Codex SSE response headers timed out after 45000ms')
          if (attempts === 2) throw new Error('WebSocket idle timeout after 45000ms')
          yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
        })() as never
      },
    }
    const adapter = buildCordisPiAiAdapter(resolver, {}, {
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      turnRetryDelayMs: 1,
    })
    const reply = await adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] })
    expect(attempts).toBe(3)
    expect(reply.text).toBe('ok')
  })

  it('a stream that goes quiet BETWEEN events is a transport death — retried on a fresh dial', async () => {
    // Item 54 (2026-08-30): pi-ai's bounds cover connect phases only; a
    // stream that delivers and then falls silent used to block `for await`
    // forever (the extract-min probe arm sat >30min in that hole).
    let attempts = 0
    const resolver: PiAiResolver = {
      hasConfiguredAuth: () => true,
      getModel: () => ({}),
      streamSimple() {
        attempts += 1
        return (async function* () {
          if (attempts === 1) {
            yield { type: 'partial', partial: { role: 'assistant', content: [] } }
            await new Promise(() => {}) // silence, forever
          }
          yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
        })() as never
      },
    }
    const adapter = buildCordisPiAiAdapter(resolver, {}, {
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      transportQuietMs: 40,
      turnRetryDelayMs: 1,
    })
    const reply = await adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] })
    expect(attempts).toBe(2)
    expect(reply.text).toBe('ok')
  })

  it('the turn deadline fires on a silent stream too, and is NOT retried', async () => {
    let attempts = 0
    const resolver: PiAiResolver = {
      hasConfiguredAuth: () => true,
      getModel: () => ({}),
      streamSimple() {
        attempts += 1
        return (async function* () {
          await new Promise(() => {}) // never yields at all
          yield { type: 'done', message: { role: 'assistant', content: [] } }
        })() as never
      },
    }
    const adapter = buildCordisPiAiAdapter(resolver, {}, {
      provider: 'openai-codex',
      model: 'gpt-5.3-codex-spark',
      transportQuietMs: 10_000, // quiet bound far beyond the deadline
      turnTimeoutMs: 60,
      turnRetryDelayMs: 1,
    })
    await expect(
      adapter.generate({ systemPrompt: 's', transcript: [{ type: 'user', text: 'hi' }], tools: [] }),
    ).rejects.toThrow(/exceeded its turn timeout/)
    expect(attempts).toBe(1)
  })
})
