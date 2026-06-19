import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentEventRecord } from '../types.ts'
import type { EventHub } from '../core/event-hub.ts'
import type { BrainAdapter, BrainEvent, BrainResult } from './brain-adapter.ts'

export type AgentStatus = 'running' | 'completed' | 'cancelled' | 'error'

export interface AgentSessionDeps {
  readonly id: string
  readonly intent: string
  readonly tools: readonly string[]
  readonly systemPrompt: string
  readonly adapter: BrainAdapter
  readonly hub: EventHub
  /** Captured at construction — pins the session to its origin workspace (MAR Lock / C5). */
  readonly root: string
  /** Fired once on terminal state — Task 5 wires lease-release + token-revoke here. */
  readonly onTerminal?: (result: BrainResult) => void
  readonly now?: () => string
}

/**
 * Drives one BrainAdapter run: republishes each BrainEvent onto the hub topic
 * `agent:<id>` (carrying a restart-stable `idx` plus the hub `seq`), captures an
 * in-memory transcript, and durably appends to `.waypoint/agent/<id>.jsonl` via
 * an awaited write chain. A transcript-write failure degrades gracefully — it
 * never masks an otherwise-completed run.
 */
export class AgentSession {
  readonly id: string
  readonly startedAt: string
  private readonly deps: AgentSessionDeps
  private readonly controller = new AbortController()
  private readonly events: BrainEvent[] = []
  private idx = 0
  private statusValue: AgentStatus = 'running'
  private writeChain: Promise<void> = Promise.resolve()

  constructor(deps: AgentSessionDeps) {
    this.deps = deps
    this.id = deps.id
    this.startedAt = (deps.now ?? (() => new Date().toISOString()))()
  }

  get intent(): string {
    return this.deps.intent
  }

  status(): AgentStatus {
    return this.statusValue
  }

  transcript(): readonly BrainEvent[] {
    return this.events
  }

  cancel(): void {
    this.controller.abort()
  }

  async run(): Promise<BrainResult> {
    const dir = join(this.deps.root, '.waypoint', 'agent')
    await mkdir(dir, { recursive: true })
    const transcriptPath = join(dir, `${this.id}.jsonl`)

    const result = await this.deps.adapter.runSession({
      intent: this.deps.intent,
      tools: this.deps.tools,
      systemPrompt: this.deps.systemPrompt,
      signal: this.controller.signal,
      onEvent: (event) => {
        this.events.push(event)
        const idx = this.idx++
        const record: AgentEventRecord = {
          id: `${this.id}:${idx}`,
          sessionId: this.id,
          kind: event.kind,
          at: event.at,
          idx,
          data: event.data,
        }
        const published = this.deps.hub.publishAgent(`agent:${this.id}`, record)
        // Persist the dual cursor: restart-stable idx + live hub seq (Lock 4).
        const line = `${JSON.stringify({ ...record, seq: published.seq })}\n`
        this.writeChain = this.writeChain.then(() => appendFile(transcriptPath, line, 'utf8'))
      },
    })

    try {
      await this.writeChain
    } catch {
      // Audit-log write failed (e.g. disk full). Do not mask the run's outcome.
    }

    this.statusValue =
      result.status === 'error' ? 'error' : result.status === 'cancelled' ? 'cancelled' : 'completed'
    this.deps.onTerminal?.(result)
    return result
  }
}
