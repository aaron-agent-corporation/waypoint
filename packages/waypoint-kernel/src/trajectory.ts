/**
 * Shared trajectory record — the forensic ledger of everything a model
 * saw, distinct from the host chat transcript (docs: durable trajectory).
 *
 * Chat stays the human story. These records are the append-only journal
 * of user / assistant / tool / usage / compaction / prompt / waypoint events.
 */
import type { CordisSessionEvent, CordisUsage } from './kernel.ts'

export type TrajectoryScope = 'brain' | 'worker' | 'waypoint'

export type TrajectoryType =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'usage'
  | 'compaction'
  | 'prompt'
  | 'waypoint'

export interface TrajectoryCall {
  readonly id: string
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

export interface TrajectoryOutcome {
  readonly status: string
  readonly output: string
}

export interface TrajectoryUsage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly total_tokens: number
  readonly cost_usd?: number
}

export interface TrajectoryRecord {
  readonly seq: number
  readonly ts: string
  readonly scope: TrajectoryScope
  readonly session_id: string
  readonly run_id?: string
  readonly actor?: string
  readonly type: TrajectoryType
  readonly source?: string
  readonly text?: string
  readonly call?: TrajectoryCall
  readonly outcome?: TrajectoryOutcome
  readonly usage?: TrajectoryUsage
  readonly item_id?: string
  readonly response_id?: string
}

export interface SessionEventsToRecordsOptions {
  readonly scope: TrajectoryScope
  readonly sessionId: string
  readonly runId?: string
  readonly actor?: string
  readonly source?: string
  readonly seqStart?: number
  readonly now?: () => Date
}

/** Map a live Cordis session-event slice onto TrajectoryRecords. */
export function sessionEventsToRecords(
  events: readonly CordisSessionEvent[],
  opts: SessionEventsToRecordsOptions,
): TrajectoryRecord[] {
  const now = opts.now ?? (() => new Date())
  let seq = opts.seqStart ?? 0
  const records: TrajectoryRecord[] = []
  for (const event of events) {
    const ts = now().toISOString()
    const base = {
      seq: seq++,
      ts,
      scope: opts.scope,
      session_id: opts.sessionId,
      ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
      ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
      ...(opts.source !== undefined ? { source: opts.source } : {}),
    }
    if (event.type === 'user' || event.type === 'assistant') {
      records.push({ ...base, type: event.type, text: event.text })
      continue
    }
    if (event.type === 'tool_call') {
      records.push({
        ...base,
        type: 'tool_call',
        call: { id: event.call.id, name: event.call.name, args: { ...event.call.args } },
      })
      continue
    }
    records.push({
      ...base,
      type: 'tool_result',
      call: { id: event.call.id, name: event.call.name, args: { ...event.call.args } },
      outcome: { status: event.outcome.status, output: event.outcome.output },
    })
  }
  return records
}

export interface PromptSection {
  readonly id: string
  readonly title: string
  readonly body: string
}

/** One `prompt` record per system-prompt section, emitted at session start. */
export function promptSectionsToRecords(
  sections: readonly PromptSection[],
  opts: SessionEventsToRecordsOptions,
): TrajectoryRecord[] {
  const now = opts.now ?? (() => new Date())
  let seq = opts.seqStart ?? 0
  return sections.map((section) => ({
    seq: seq++,
    ts: now().toISOString(),
    scope: opts.scope,
    session_id: opts.sessionId,
    ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
    ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
    type: 'prompt' as const,
    source: opts.source ?? 'host',
    text: `${section.title}\n\n${section.body}`,
  }))
}

export function usageToRecord(
  usage: CordisUsage,
  opts: SessionEventsToRecordsOptions,
): TrajectoryRecord {
  const now = opts.now ?? (() => new Date())
  return {
    seq: opts.seqStart ?? 0,
    ts: now().toISOString(),
    scope: opts.scope,
    session_id: opts.sessionId,
    ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
    ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
    type: 'usage',
    ...(opts.source !== undefined ? { source: opts.source } : {}),
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      ...(usage.costUsd !== undefined ? { cost_usd: usage.costUsd } : {}),
    },
  }
}

export function compactionToRecord(
  opts: SessionEventsToRecordsOptions & {
    readonly removed: number
    readonly digest: string
    readonly archivedTotal?: number
  },
): TrajectoryRecord {
  const now = opts.now ?? (() => new Date())
  return {
    seq: opts.seqStart ?? 0,
    ts: now().toISOString(),
    scope: opts.scope,
    session_id: opts.sessionId,
    ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
    ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
    type: 'compaction',
    source: opts.source ?? 'host',
    text: opts.digest,
    usage: {
      input_tokens: opts.removed,
      output_tokens: opts.archivedTotal ?? opts.removed,
      total_tokens: opts.removed,
    },
  }
}

/** Tag loop / watch / host wake-ups from the existing `[System: …]` prefixes. */
export function sourceFromUserText(text: string): string {
  const trimmed = text.trimStart()
  if (trimmed.startsWith("[System: loop")) return 'loop'
  if (trimmed.startsWith('[System: watch')) return 'watch'
  if (trimmed.startsWith('[System:')) return 'host'
  return 'operator'
}
