import type { BrainEvent } from './brain-adapter.ts'

/**
 * Buffered decoder for Pi's `--mode json` stdout stream. Pi emits one JSON
 * `AgentSessionEvent` per line (after a `session` header line). This decoder
 * tolerates the realities of a piped child stream: a chunk may carry a partial
 * line, multiple lines, or a trailing line with no newline (delivered on
 * `flush()` at close). Malformed lines are skipped, never thrown.
 *
 * The kind map + drop list are derived from real captured fixtures
 * (`__fixtures__/pi-stream/`, Task 0 / Spike 1). A future `pi` bump that changes
 * the schema is caught by the committed snapshot test, not silently absorbed.
 */

/** Top-level Pi event `type` → normalized `BrainEvent.kind`. */
const KIND_MAP: Readonly<Record<string, string>> = Object.freeze({
  tool_execution_start: 'agent.toolcall',
  tool_execution_end: 'agent.tool_result',
  agent_end: 'agent.end',
})

/**
 * Streaming-delta / duplicate event types we deliberately drop — they restate
 * data already carried by the mapped events (Spike 1: "the decoder can ignore
 * the deltas and rely on the top-level tool_execution_* pair").
 */
const DROP_TYPES: ReadonlySet<string> = new Set(['message_start', 'message_update'])

export interface PiStreamDecoderOptions {
  readonly now?: () => string
}

export class PiStreamDecoder {
  private buffer = ''
  private readonly now: () => string

  constructor(options: PiStreamDecoderOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** Feed a stdout chunk; returns any complete events it newly contains. */
  push(chunk: string): BrainEvent[] {
    this.buffer += chunk
    const events: BrainEvent[] = []
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      const event = this.decodeLine(line)
      if (event) events.push(event)
      newlineIndex = this.buffer.indexOf('\n')
    }
    return events
  }

  /** Drain any trailing buffered line with no terminating newline (call at close). */
  flush(): BrainEvent[] {
    const line = this.buffer
    this.buffer = ''
    const event = this.decodeLine(line)
    return event ? [event] : []
  }

  private decodeLine(rawLine: string): BrainEvent | null {
    const line = rawLine.trim()
    if (line === '') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return null // malformed line — skip, never throw
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null
    return this.toBrainEvent(parsed, parsed.type)
  }

  private toBrainEvent(record: Record<string, unknown>, type: string): BrainEvent | null {
    if (DROP_TYPES.has(type)) return null

    if (type === 'message_end') return this.assistantMessageEvent(record)

    const mapped = KIND_MAP[type]
    if (mapped === 'agent.toolcall') {
      return { kind: mapped, at: this.now(), data: { toolName: stringField(record.toolName) } }
    }
    if (mapped === 'agent.tool_result') {
      return {
        kind: mapped,
        at: this.now(),
        data: {
          toolName: stringField(record.toolName),
          text: toolResultText(record.result),
          isError: record.isError === true,
        },
      }
    }
    if (mapped === 'agent.end') {
      return { kind: mapped, at: this.now() }
    }

    // Unknown / structural type → pass through as agent.<type>.
    return { kind: `agent.${type}`, at: this.now() }
  }

  private assistantMessageEvent(record: Record<string, unknown>): BrainEvent | null {
    const message = isRecord(record.message) ? record.message : null
    if (!message || message.role !== 'assistant') return null
    const text = assistantText(message.content)
    if (text === '') return null // toolUse-only assistant turn carries no message text
    return { kind: 'agent.message', at: this.now(), data: { text } }
  }
}

/**
 * Derive the terminal `BrainResult` fields from a decoded event stream. A run is
 * `completed` when an `agent.end` event arrived; otherwise we still salvage a
 * `completed` if a tool result surfaced a `proposalId`/`adhocRouteId`. With
 * neither, the stream never terminated cleanly → `error`. The caller (adapter)
 * overrides this with `cancelled` on abort or `error` on a non-zero exit.
 */
export function extractBrainResult(events: readonly BrainEvent[]): BrainResultDraft {
  let summary: string | undefined
  let proposalId: string | undefined
  let adhocRouteId: string | undefined
  let sawEnd = false

  for (const event of events) {
    if (event.kind === 'agent.message') {
      const text = stringField(event.data?.text)
      if (text) summary = text
    } else if (event.kind === 'agent.tool_result') {
      const ids = idsFromToolResultText(stringField(event.data?.text))
      if (ids.proposalId) proposalId = ids.proposalId
      if (ids.adhocRouteId) adhocRouteId = ids.adhocRouteId
    } else if (event.kind === 'agent.end') {
      sawEnd = true
    }
  }

  const terminal = sawEnd || proposalId !== undefined || adhocRouteId !== undefined
  return {
    status: terminal ? 'completed' : 'error',
    ...(summary !== undefined ? { summary } : {}),
    ...(proposalId !== undefined ? { proposalId } : {}),
    ...(adhocRouteId !== undefined ? { adhocRouteId } : {}),
    ...(terminal ? {} : { error: 'Pi stream ended without a terminal agent.end event' }),
  }
}

export interface BrainResultDraft {
  readonly status: 'completed' | 'error'
  readonly summary?: string
  readonly proposalId?: string
  readonly adhocRouteId?: string
  readonly error?: string
}

function idsFromToolResultText(text: string): { proposalId?: string; adhocRouteId?: string } {
  if (text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return {}
    return {
      ...(typeof parsed.proposalId === 'string' ? { proposalId: parsed.proposalId } : {}),
      ...(typeof parsed.adhocRouteId === 'string' ? { adhocRouteId: parsed.adhocRouteId } : {}),
    }
  } catch {
    return {}
  }
}

function toolResultText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return ''
  return result.content
    .filter(isRecord)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

function assistantText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
