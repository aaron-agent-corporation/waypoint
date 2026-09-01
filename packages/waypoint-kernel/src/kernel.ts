/**
 * Cordis agent kernel — shared service contracts + typed events
 * (docs/designs/cordis-adoption-plan.md, Phase A).
 *
 * These interfaces are the "service definition" third of the capability seam
 * (definition / provider / consumer). Providers register via ctx.provide();
 * consumers declare inject and use the key only. The contracts are ported
 * verbatim from the parent project's kernel — they are the interoperability
 * surface the brain and every future plugin are written against — with one
 * Waypoint extension: prompt sections carry an optional `source` (provenance —
 * a reader of the assembled prompt must be able to answer "who wrote this?",
 * and the answer must always be a file, never the composer).
 */
// The import is required for `declare module 'cordis'` below to merge with
// the package's own declarations instead of shadowing them. It must be a
// side-effect import (not `import type {}`): declaration emit elides
// type-only imports, and a dist/kernel.d.ts without the import breaks the
// augmentation for every consumer of the built package (the brain).
import 'cordis'

/** JSON-Schema-shaped parameters (typebox TSchema serializes to this). */
export type ToolParameters = Readonly<Record<string, unknown>>

export interface CordisToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParameters
}

export interface CordisToolCall {
  /** Provider-issued tool-call id — flows back on the tool result message. */
  readonly id: string
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

export type CordisToolStatus = 'ok' | 'denied' | 'error'

export interface CordisToolOutcome {
  readonly status: CordisToolStatus
  readonly output: string
}

export type CordisToolHandler = (args: Readonly<Record<string, unknown>>) => string | Promise<string>

export interface CordisToolsService {
  /** Returns a disposer; callers must wrap in their own ctx.effect(). */
  register(schema: CordisToolSchema, handler: CordisToolHandler): () => void
  list(): readonly CordisToolSchema[]
  execute(call: CordisToolCall): Promise<CordisToolOutcome>
}

export type CordisSessionEvent =
  | { readonly type: 'user'; readonly text: string }
  | { readonly type: 'assistant'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: CordisToolCall }
  | { readonly type: 'tool_result'; readonly call: CordisToolCall; readonly outcome: CordisToolOutcome }

export interface CordisSessionsService {
  append(event: CordisSessionEvent): void
  all(): readonly CordisSessionEvent[]
  /**
   * Compaction: replace events `[0, keepFrom)` with one synthetic user event
   * carrying `digest`, returning the removed events so the caller can archive
   * them for recall. `keepFrom` should land on a turn boundary (a 'user'
   * event) so tool_call/tool_result pairing survives the cut. Throws on an
   * out-of-range boundary.
   */
  compact(keepFrom: number, digest: string): readonly CordisSessionEvent[]
  /**
   * Pruning: replace the OUTPUT of the tool_result at `index` in place
   * (the compaction pruner's narrow mutation — pairing, order, and every
   * other event stay untouched). Returns the replaced event so the caller
   * can archive the verbatim original for recall. Throws when `index` is
   * out of range or does not hold a tool_result.
   */
  rewriteToolResult(index: number, output: string): CordisSessionEvent
}

export interface CordisSystemPromptService {
  /**
   * Returns a disposer; callers must wrap in their own ctx.effect().
   * `source` is Waypoint's provenance extension: the file path the body was
   * read from, or 'composed' for the few sections the composer itself owns.
   */
  addSection(id: string, title: string, body: string, source?: string): () => void
  render(): string
  sectionIds(): readonly string[]
  /** Section contents in render order — the composition-audit surface. */
  sections(): ReadonlyArray<{ readonly id: string; readonly title: string; readonly body: string; readonly source?: string }>
}

export interface CordisLlmRequest {
  readonly systemPrompt: string
  readonly tools: readonly CordisToolSchema[]
  /** Full neutral transcript, oldest first. The adapter owns the mapping to
   *  its provider's wire format (and may keep a cursor across turns). */
  readonly transcript: readonly CordisSessionEvent[]
  readonly signal?: AbortSignal
}

/** Provider-reported token usage for one generate (or a turn's sum). */
export interface CordisUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly costUsd?: number
}

export interface CordisLlmReply {
  readonly text?: string
  readonly toolCalls?: readonly CordisToolCall[]
  /** Usage for THIS generate, when the adapter's provider reports it. */
  readonly usage?: CordisUsage
}

export interface CordisLlmAdapter {
  readonly id: string
  generate(req: CordisLlmRequest): Promise<CordisLlmReply>
}

export interface CordisLlmService {
  /** Returns a disposer; callers must wrap in their own ctx.effect(). */
  registerAdapter(adapter: CordisLlmAdapter): () => void
  adapterId(): string | undefined
  generate(req: CordisLlmRequest): Promise<CordisLlmReply>
}

export interface CordisTurnStep {
  readonly call: CordisToolCall
  readonly outcome: CordisToolOutcome
}

export interface CordisTurnResult {
  readonly text: string
  readonly steps: readonly CordisTurnStep[]
  /** True when a terminate tool (the report seam) completed the run. */
  readonly terminated: boolean
  /** Summed usage across every generate in the turn, when reported. */
  readonly usage?: CordisUsage
}

export interface CordisAgentLoopService {
  runTurn(input: string, signal?: AbortSignal): Promise<CordisTurnResult>
}

export interface CordisToolExecRequest {
  readonly call: CordisToolCall
}

declare module 'cordis' {
  interface Context {
    tools: CordisToolsService
    llm: CordisLlmService
    sessions: CordisSessionsService
    systemPrompt: CordisSystemPromptService
    agentLoop: CordisAgentLoopService
  }
  interface Events {
    /** Waterfall: policy plugins wrap tool execution; short-circuit to deny. */
    'waypoint/cordis-tool-execute'(
      req: CordisToolExecRequest,
      next: () => Promise<CordisToolOutcome>,
    ): Promise<CordisToolOutcome>
  }
}
