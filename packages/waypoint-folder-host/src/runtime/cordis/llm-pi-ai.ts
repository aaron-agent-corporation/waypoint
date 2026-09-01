/**
 * The pi-ai model adapter behind `ctx.llm` — pi-ai for auth and wire format.
 *
 * This is the seam the harness decision turned on, and the choice is deliberate
 * rather than incidental. What it costs to own the provider stack instead was
 * measured, not guessed:
 *
 *   pi-ai auth + api layers ......... 8,031 LOC
 *   OAuth flows alone, 7 providers .. 1,809 LOC
 *   openai-codex OAuth alone ........   442 LOC
 *
 * Owning that means owning those. Using Cordis for composition and pi-ai for
 * providers means owning this file. It also means a cordis worker inherits the
 * EXISTING sign-in surface — the credential store is pi's own
 * `~/.pi/agent/auth.json`, which the Console already manages through its
 * Subscriptions page, so no second place to sign in appears.
 *
 * THE ADAPTER OWNS THE TRANSCRIPT MAPPING (kernel contract): the loop speaks
 * neutral session events; this file translates them to pi-ai messages. It
 * keeps the REAL AssistantMessages it received — ids, thought signatures and
 * stop reasons the next request has to echo back — rather than reconstructing
 * them from the neutral log, and tracks a cursor so each generate only
 * translates what is new. A lossy round-trip is how a multi-turn conversation
 * quietly degrades into a series of unrelated first turns.
 *
 * NEVER LOGS A TOKEN. Provider and model ids are named in errors; credentials
 * never leave pi's store.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Context } from 'cordis'
import type {
  CordisLlmAdapter,
  CordisLlmReply,
  CordisLlmRequest,
  CordisToolCall,
  CordisUsage,
} from '@waypoint-engine/kernel'

export interface CordisPiAiConfig {
  /** pi provider id, e.g. 'openai-codex'. */
  readonly provider: string
  /** Model id within that provider, e.g. 'gpt-5.6-terra'. */
  readonly model: string
  /** Fail fast rather than hang on a provider that is not answering. */
  readonly turnTimeoutMs?: number
  /**
   * S2 (item 52): how many times a turn whose STREAM died in transport is
   * re-asked before the failure surfaces (S1 finding 3: in-guest quiet
   * reasoning streams die at ~90–110s as "terminated"/"WebSocket error").
   * Bounded, never silent — each retry prints to stderr. Default 4 retries
   * (5 attempts): the sprite egress path drops flows at random (measured
   * 2-of-5 in one sample, item 54 gap profiler 2026-08-30), and a long
   * extract task makes 8–15 turns — each turn must survive the lottery, so
   * per-turn survival has to be ~0.99, not ~0.94. With the 15s headers
   * bound a dead dial costs 15s, so five attempts worst-case ≈ 75s.
   * Provider refusals, auth failures and the turn timeout are never
   * retried; a dead connection is the only thing this forgives.
   */
  readonly turnRetries?: number
  /** Delay between turn retries (test seam; default 1s). */
  readonly turnRetryDelayMs?: number
  /**
   * Item 54 (2026-08-29/30): the sprite egress path drops flows at RANDOM —
   * SYNs vanish (OS gives up ~75s, ETIMEDOUT) and, rarer, an established
   * flow stalls mid-stream. The gap profiler (2026-08-30) measured 2-of-5
   * fresh dials blackholed in one minute while the "worst" payload streamed
   * to EOF in 1.4s from the same sprite — payload-blind, per-flow. Every
   * apparent payload/tool-group correlation was amplification: extract
   * tasks make 8–15 turns (more dials, more lottery tickets), and WS socket
   * reuse turned one poisoned socket into a streak of dead attempts.
   *
   * So every wait gets its own tight, phase-NAMED bound, and the bounded
   * turn-retry re-dials a fresh flow. Three knobs, three phases:
   * headersTimeoutMs (SSE dial→response headers — the phase the blackhole
   * kills; healthy is 0.5–2s), connectTimeoutMs (WS upgrade),
   * transportQuietMs (between stream events AFTER headers — our watchdog;
   * generous because a model may legitimately think between events).
   */
  /** SSE connect→response-headers bound (pi-ai timeoutMs; on WS transports it is the idle bound). Default 15s. */
  readonly headersTimeoutMs?: number
  /** Between-events watchdog AFTER the stream starts (ours). Default 45s. */
  readonly transportQuietMs?: number
  /** WebSocket connect/upgrade bound. Default 10s (pi-ai's own default is 15s). */
  readonly connectTimeoutMs?: number
  /**
   * Wire transport for codex turns. Default 'sse', NOT pi-ai's 'auto'.
   *
   * Item 54 (2026-08-30): on a lossy per-flow egress path, WS is an
   * AMPLIFIER — pi-ai pools WS sockets (keyed by a sessionId this adapter
   * does not pass), so one poisoned socket is reused across attempts and a
   * single bad flow becomes a streak of dead turns (witnessed: 6+
   * consecutive 45s idle deaths). Its WS→SSE fallback cannot rescue an
   * ACKed-then-silent stream (it only fires when the socket dies before
   * the first mapped event). SSE dials a FRESH flow per attempt — exactly
   * what retrying through a lossy path wants — and zstd-compresses the
   * request. WS buys connection-scoped context caching we do not need at
   * the price of correlated failures we measured. Overridable for A/B
   * probes, not for prod.
   */
  readonly transport?: 'sse' | 'auto' | 'websocket'
  /** Override the credential store (test seam). */
  readonly authPath?: string
  /** Inject a resolver instead of building the real one (test seam). */
  readonly resolverFactory?: () => Promise<PiAiResolver>
}

/** The narrow slice of pi's ModelRuntime we depend on — kept small on purpose,
 *  so the size of the coupling is visible in one place. */
export interface PiAiResolver {
  hasConfiguredAuth(provider: string): boolean
  getModel(provider: string, model: string): unknown
  streamSimple(model: unknown, context: unknown, options?: unknown): AsyncIterable<StreamEvent>
}

interface StreamEvent {
  readonly type: string
  readonly message?: PiAssistantMessage
  readonly partial?: PiAssistantMessage
  /**
   * Where a FAILED turn's detail actually lives. pi-ai emits
   * `{type:'error', reason, error:{…, errorMessage}}` — the assistant message
   * carrying `errorMessage` is under `error`, not `message`, and reading only
   * `message` turned every provider failure into the word "unknown". A whole
   * H-8 provider run reported `model openrouter/z-ai/glm-4.6 failed: unknown`
   * when the provider had said, precisely, "Provider is not configured:
   * openrouter".
   */
  readonly error?: PiAssistantMessage
  readonly reason?: string
}

interface PiContentText {
  readonly type: 'text'
  readonly text: string
}
interface PiContentToolCall {
  readonly type: 'toolCall'
  readonly id: string
  readonly name: string
  readonly arguments: Record<string, unknown>
}
type PiContent = PiContentText | PiContentToolCall | { readonly type: string }

interface PiAssistantMessage {
  readonly role?: string
  readonly content?: readonly PiContent[]
  readonly usage?: unknown
  readonly stopReason?: string
  readonly errorMessage?: string
}

/**
 * The most specific sentence available for a failed turn.
 *
 * Order matters: the provider's own words first, then whatever the event
 * labelled the failure, and only then a shape dump. Never the bare word
 * "unknown" — an operator reading a failed dispatch needs to know whether the
 * provider is unconfigured, the token expired, or the model refused, and those
 * three demand different actions. If a future pi-ai moves the field again, the
 * serialized event is worse than a sentence but still tells you where to look.
 */
function streamErrorDetail(event: StreamEvent): string {
  const stated = event.error?.errorMessage ?? event.message?.errorMessage
  if (stated !== undefined && stated.trim() !== '') return stated
  if (event.reason !== undefined && event.reason !== '' && event.reason !== 'error') return event.reason
  try {
    // Credentials never appear in an error event's shape — it carries provider,
    // model, usage and stop reason. Serializing it is safe and beats "unknown".
    return `the provider reported an error with no message (${JSON.stringify(event).slice(0, 400)})`
  } catch {
    return 'the provider reported an error with no message, and the event could not be serialized'
  }
}

/**
 * Is this a TRANSPORT death — a connection that died under the turn — rather
 * than the provider answering with a refusal?
 *
 * The S1 sprite witness characterized the failure this classifies: long quiet
 * reasoning streams die in-guest at ~90–110s as "terminated" or "WebSocket
 * error" while idle sockets survive 200s+ and short-turn models complete.
 * Those deserve a bounded re-ask. Everything the provider SAID — unconfigured
 * provider, lapsed token, model refusal — must surface immediately: retrying
 * it burns attempts on a failure whose fix is an operator action, and the
 * deliberate turn timeout ("exceeded its turn timeout") is a budget, not a
 * blip. Matching is on the failure sentence because that is all pi-ai hands
 * up; the list errs narrow — an unmatched new phrasing fails fast, which is
 * the safe direction.
 */
function isTransportDeath(message: string): boolean {
  if (/exceeded its turn timeout/i.test(message)) return false
  // "timed out after \d+ms" / "idle timeout after \d+ms" are pi-ai's OWN
  // phase-named transport bounds (SSE headers, WS idle) — retryable dials.
  // Our adapter's "exceeded its turn timeout" deliberately does NOT match.
  // "stream went quiet for \d+ms" is our own between-events watchdog — a
  // delivered-then-silent stream retries on a fresh dial like any other
  // transport death.
  // "Request timed out." is the bundled OpenAI client's APIConnectionTimeoutError
  // — an ABORTED dial (our own headers bound firing on a slow first byte), not
  // a provider answer. Route-012 (2026-08-31): glm-4.6's reasoning first byte
  // outgrew the codex-tuned bound, and this unmatched phrasing killed every
  // turn on its first attempt — no retry, no recycle, task parked.
  return /terminated|websocket|socket hang up|econnreset|econnrefused|etimedout|epipe|connection (?:reset|closed|lost)|premature close|fetch failed|network error|stream ended without a done event|(?:timed out|timeout) after \d+ms|request timed out|stream went quiet for \d+ms/i.test(
    message,
  )
}

/** pi-ai usage → the kernel's CordisUsage, defensively: pi's field names have
 *  moved before, and absent metering must read as absent, never as zero cost. */
function mapPiUsage(usage: unknown): CordisUsage | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const u = usage as Record<string, unknown>
  const num = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = u[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
  }
  const input = num('input', 'inputTokens', 'input_tokens')
  const output = num('output', 'outputTokens', 'output_tokens')
  if (input === undefined && output === undefined) return undefined
  const cacheRead = num('cacheRead', 'cacheReadTokens', 'cache_read_input_tokens')
  const cacheWrite = num('cacheWrite', 'cacheWriteTokens', 'cache_creation_input_tokens')
  const cost = (() => {
    const direct = num('costUsd', 'cost_usd')
    if (direct !== undefined) return direct
    const nested = u.cost
    if (typeof nested === 'object' && nested !== null) {
      const total = (nested as Record<string, unknown>).total
      if (typeof total === 'number' && Number.isFinite(total)) return total
    }
    return undefined
  })()
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    totalTokens: num('totalTokens', 'total_tokens') ?? (input ?? 0) + (output ?? 0),
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(cost !== undefined ? { costUsd: cost } : {}),
  }
}

async function defaultResolver(authPath: string): Promise<PiAiResolver> {
  // Lazy: the pi deps are heavy, and a worker that never reaches a model
  // should not pay to load them.
  const mod = (await import('@earendil-works/pi-coding-agent')) as unknown as {
    ModelRuntime: { create(options: { authPath: string }): Promise<PiAiResolver> }
  }
  return mod.ModelRuntime.create({ authPath })
}

/** Build the adapter itself — exported so a future provider plugin (or the
 *  brain) can construct one without mounting the worker plugin. */
export function buildCordisPiAiAdapter(
  resolver: PiAiResolver,
  model: unknown,
  config: CordisPiAiConfig,
): CordisLlmAdapter {
  const id = `${config.provider}/${config.model}`

  // The adapter's own pi-ai transcript. Assistant messages are appended as
  // received from the stream; user/tool-result messages are translated from
  // the neutral log past the cursor.
  const messages: unknown[] = []
  let cursor = 0

  return {
    id,
    async generate(req: CordisLlmRequest): Promise<CordisLlmReply> {
      const transcript = req.transcript
      for (; cursor < transcript.length; cursor++) {
        const event = transcript[cursor]!
        if (event.type === 'user') {
          messages.push({ role: 'user', content: [{ type: 'text', text: event.text }], timestamp: Date.now() })
        } else if (event.type === 'tool_result') {
          messages.push({
            role: 'toolResult',
            toolCallId: event.call.id,
            toolName: event.call.name,
            content: [{ type: 'text', text: event.outcome.output }],
            isError: event.outcome.status !== 'ok',
            timestamp: Date.now(),
          })
        }
        // 'assistant' and 'tool_call' events are ours: the full AssistantMessage
        // (including its ToolCall content) was already appended below, verbatim.
      }

      const tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        // The MCP server already publishes JSON Schema; pass it through rather
        // than re-deriving it — a second derivation is a second thing to drift.
        parameters: t.parameters,
      }))

      // One attempt: open the stream and consume it to the done event. The
      // transcript above is already translated and `messages` is only appended
      // on success, so re-asking is byte-identical to the first ask.
      const attemptTurn = async (): Promise<PiAssistantMessage> => {
        const stream = resolver.streamSimple(
          model,
          {
            systemPrompt: req.systemPrompt,
            messages,
            ...(tools.length > 0 ? { tools } : {}),
          },
          {
            ...(req.signal ? { signal: req.signal } : {}),
            // Connect-phase bounds (see CordisPiAiConfig): a dropped dial must
            // fail fast and NAMED, not ride the OS SYN-retry window to ~75s.
            // Codex headers arrive in 0.5–2s, but reasoning models buffer
            // their first byte behind thinking — glm-4.6 measured 10s+ on a
            // single request host-side and past 15s under concurrent load
            // (route-012, 2026-08-31), so 15s starved every OpenRouter turn.
            // 45s fits reasoning first-byte and stays under the ~75s SYN
            // window; a bound that still proves too tight now costs a RETRY
            // (the classifier knows the client's abort text), never the task.
            timeoutMs: config.headersTimeoutMs ?? 45_000,
            websocketConnectTimeoutMs: config.connectTimeoutMs ?? 10_000,
            // Pinned to the SSE path by default (see CordisPiAiConfig.transport):
            // a fresh flow per attempt — WS socket reuse turns one poisoned
            // flow into a streak of dead attempts on the lossy sprite path.
            transport: config.transport ?? 'sse',
          },
        )

        const deadline = Date.now() + (config.turnTimeoutMs ?? 120_000)
        // Between-events watchdog. pi-ai's own bounds cover the CONNECT
        // phases only (SSE connect→headers, WS idle); a stream that delivers
        // headers and then goes quiet blocks a plain `for await` forever, and
        // the deadline check below it is dead code because it only runs per
        // event. Item 54 (2026-08-30): the extract-min probe arm sat >30min
        // in exactly that hole. So every next() races the quiet bound and
        // the turn deadline, and whichever fires is NAMED — the quiet death
        // is a transport death (retried on a fresh dial); the deadline is
        // ours (not retried).
        const quietMs = config.transportQuietMs ?? 45_000
        const iterator = (stream as AsyncIterable<StreamEvent>)[Symbol.asyncIterator]()
        let done: PiAssistantMessage | null = null
        try {
          for (;;) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) throw new Error(`model ${id} exceeded its turn timeout`)
            let timer: ReturnType<typeof setTimeout> | undefined
            const bound = Math.min(quietMs, remaining)
            const next = await Promise.race([
              iterator.next(),
              new Promise<'quiet'>((resolve) => {
                timer = setTimeout(() => resolve('quiet'), bound)
              }),
            ]).finally(() => clearTimeout(timer))
            if (next === 'quiet') {
              if (deadline - Date.now() <= 0) throw new Error(`model ${id} exceeded its turn timeout`)
              throw new Error(`model ${id} stream went quiet for ${bound}ms between events`)
            }
            if (next.done) break
            const event = next.value
            if (event.type === 'done') {
              done = event.message ?? event.partial ?? null
              break
            }
            if (event.type === 'error') {
              throw new Error(`model ${id} failed: ${streamErrorDetail(event)}`)
            }
          }
        } finally {
          // Best-effort release of the underlying stream when we bail early.
          void iterator.return?.().catch(() => {})
        }
        if (!done) throw new Error(`model ${id} stream ended without a done event`)
        return done
      }

      // S2 (item 52): bounded turn-retry for transport deaths — a killed
      // stream retries the turn; bounded, and NEVER silently (each retry is a
      // stderr line, and an exhausted retry says how many attempts it made).
      const maxAttempts = 1 + Math.max(0, config.turnRetries ?? 4)
      let final: PiAssistantMessage | null = null
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          final = await attemptTurn()
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // The host cancelling the run also kills the stream; that is a
          // stop, not a blip — never re-ask a turn the caller aborted.
          if (req.signal?.aborted || !isTransportDeath(message)) throw error
          if (attempt === maxAttempts) {
            throw new Error(`${message} (stream died on all ${maxAttempts} attempts)`)
          }
          console.error(
            `[cordis-pi-ai] model ${id} turn attempt ${attempt}/${maxAttempts} died in transport (${message}) — retrying`,
          )
          await new Promise((resolve) => setTimeout(resolve, config.turnRetryDelayMs ?? 1_000))
        }
      }
      if (!final) throw new Error(`model ${id} stream ended without a done event`)
      messages.push(final)

      const content = final.content ?? []
      const usage = mapPiUsage(final.usage)
      const toolCalls: CordisToolCall[] = content
        .filter((c): c is PiContentToolCall => c.type === 'toolCall')
        .map((c) => ({ id: c.id, name: c.name, args: c.arguments ?? {} }))
      if (toolCalls.length > 0) return { toolCalls, ...(usage ? { usage } : {}) }

      const text = content
        .filter((c): c is PiContentText => c.type === 'text')
        .map((c) => c.text)
        .join('')
      return { text, ...(usage ? { usage } : {}) }
    },
  }
}

export async function cordisLlmPiAi(ctx: Context, config: CordisPiAiConfig): Promise<void> {
  const authPath = config.authPath ?? join(homedir(), '.pi', 'agent', 'auth.json')
  const runtime = await (config.resolverFactory ? config.resolverFactory() : defaultResolver(authPath))

  // Fail closed, and say WHICH provider. A missing subscription must never read
  // as a model that simply declined to answer.
  if (!runtime.hasConfiguredAuth(config.provider)) {
    throw new Error(
      `provider '${config.provider}' has no configured auth in ${authPath} — ` +
        'sign in via the Console Subscriptions page',
    )
  }
  const model = runtime.getModel(config.provider, config.model)
  if (!model) throw new Error(`provider '${config.provider}' does not offer model '${config.model}'`)

  const adapter = buildCordisPiAiAdapter(runtime, model, config)
  ctx.effect(() => ctx.llm.registerAdapter(adapter), `provider:${adapter.id}`)
}

cordisLlmPiAi.inject = ['llm']
