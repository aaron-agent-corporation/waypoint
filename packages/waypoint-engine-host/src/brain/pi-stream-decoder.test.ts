import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PiStreamDecoder, extractBrainResult } from './pi-stream-decoder.ts'
import type { BrainEvent } from './brain-adapter.ts'

const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__', 'pi-stream')
const BASIC = readFileSync(join(FIXTURE_DIR, 'basic-session.jsonl'), 'utf8')
const TOOL = readFileSync(join(FIXTURE_DIR, 'tool-session.jsonl'), 'utf8')

// Deterministic clock so snapshots/equality are stable regardless of wall time.
const fixedNow = (): string => '2026-06-19T00:00:00.000Z'

function decodeAll(raw: string, chunks: string[]): BrainEvent[] {
  const decoder = new PiStreamDecoder({ now: fixedNow })
  const events: BrainEvent[] = []
  for (const chunk of chunks) events.push(...decoder.push(chunk))
  events.push(...decoder.flush())
  return events
}

/** Re-chunk a string at fixed byte boundaries to simulate stream fragmentation. */
function reChunk(raw: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < raw.length; i += size) out.push(raw.slice(i, i + size))
  return out
}

describe('PiStreamDecoder', () => {
  it('decodes whole-line input and matches the committed snapshot (fails loud on Pi drift)', () => {
    const events = decodeAll(TOOL, [TOOL])
    expect(events).toMatchSnapshot()
  })

  it('is invariant to chunk boundaries (split mid-line, multi-record, trailing no-newline)', () => {
    const whole = decodeAll(TOOL, [TOOL])
    for (const size of [1, 7, 64, 500, 9999]) {
      expect(decodeAll(TOOL, reChunk(TOOL, size))).toEqual(whole)
    }
    // Trailing line with no newline is recovered by flush().
    const noTrailingNewline = TOOL.replace(/\n$/, '')
    expect(decodeAll(noTrailingNewline, [noTrailingNewline])).toEqual(whole)
  })

  it('delivers multiple records contained in a single chunk', () => {
    const decoder = new PiStreamDecoder({ now: fixedNow })
    const firstThree = BASIC.split('\n').slice(0, 3).join('\n') + '\n'
    const events = decoder.push(firstThree)
    expect(events.map((e) => e.kind)).toEqual(['agent.session', 'agent.agent_start', 'agent.turn_start'])
  })

  it('skips malformed lines without throwing', () => {
    const decoder = new PiStreamDecoder({ now: fixedNow })
    const events = decoder.push('not json\n{"type":"agent_end"}\n{bad\n')
    expect(events.map((e) => e.kind)).toEqual(['agent.end'])
  })

  it('maps the tool-call lifecycle and assistant text, dropping stream deltas', () => {
    const events = decodeAll(TOOL, [TOOL])
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('agent.toolcall')
    expect(kinds).toContain('agent.tool_result')
    expect(kinds).toContain('agent.message')
    expect(kinds).toContain('agent.end')
    expect(kinds).not.toContain('agent.message_update')

    const toolResult = events.find((e) => e.kind === 'agent.tool_result')
    expect(toolResult?.data?.toolName).toBe('waypoint_ping')
    expect(toolResult?.data?.text).toBe('pong world url=http://127.0.0.1:9999/')
    expect(toolResult?.data?.isError).toBe(false)

    const message = events.filter((e) => e.kind === 'agent.message').at(-1)
    expect(message?.data?.text).toBe('Done.')
  })
})

describe('extractBrainResult', () => {
  it('returns completed with the last assistant message as summary when agent.end arrived', () => {
    const events = decodeAll(TOOL, [TOOL])
    const result = extractBrainResult(events)
    expect(result.status).toBe('completed')
    expect(result.summary).toBe('Done.')
  })

  it('pulls proposalId/adhocRouteId out of a JSON tool result', () => {
    const events: BrainEvent[] = [
      { kind: 'agent.tool_result', at: 't', data: { toolName: 'waypoint_author_recipe', text: JSON.stringify({ proposalId: 'recipe/demo' }) } },
      { kind: 'agent.tool_result', at: 't', data: { toolName: 'waypoint_run_adhoc', text: JSON.stringify({ adhocRouteId: 'route-007' }) } },
    ]
    const result = extractBrainResult(events)
    expect(result.status).toBe('completed') // salvaged from the tool result even without agent.end
    expect(result.proposalId).toBe('recipe/demo')
    expect(result.adhocRouteId).toBe('route-007')
  })

  it('flags error when the stream never terminated', () => {
    const result = extractBrainResult([{ kind: 'agent.turn_start', at: 't' }])
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/terminal/)
  })
})

// B2: pin the tool_result → proposalId contract end-to-end through the real decoder.
// The UI's `proposalIdOf` (AgentChat.tsx) is the mirror of this path; both must stay in sync.
// A drift in either the decoder's data.text shape or extractBrainResult's JSON.parse path
// fails here rather than silently dead-rendering the Approve button.
describe('tool_result → proposalId contract (B2)', () => {
  it('decoder emits agent.tool_result whose data.text JSON-parses to the proposalId', () => {
    // Build a minimal Pi tool_execution_end record carrying a proposalId in its result text.
    const resultText = JSON.stringify({ proposalId: 'recipe/foo', status: 'pending' })
    const piRecord = JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'waypoint_author_promote',
      isError: false,
      result: { content: [{ type: 'text', text: resultText }] },
    })
    const decoder = new PiStreamDecoder({ now: fixedNow })
    const events = decoder.push(piRecord + '\n')
    const toolResult = events.find((e) => e.kind === 'agent.tool_result')
    expect(toolResult).toBeDefined()
    // data.text is the raw JSON string — same shape the UI's proposalIdOf reads.
    expect(JSON.parse(toolResult!.data!.text as string)).toMatchObject({ proposalId: 'recipe/foo' })
  })

  it('extractBrainResult surfaces proposalId from the decoded event stream', () => {
    const resultText = JSON.stringify({ proposalId: 'recipe/foo', status: 'pending' })
    const piRecord = JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'waypoint_author_promote',
      isError: false,
      result: { content: [{ type: 'text', text: resultText }] },
    })
    const decoder = new PiStreamDecoder({ now: fixedNow })
    const events = decoder.push(piRecord + '\n')
    const result = extractBrainResult(events)
    expect(result.proposalId).toBe('recipe/foo')
  })
})
