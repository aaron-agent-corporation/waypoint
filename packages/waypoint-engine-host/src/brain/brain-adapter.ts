/**
 * Provider-neutral agent driver contract. `PiCliBrainAdapter` is the first impl
 * (Task 7). The interface is deliberately free of any Pi/transport detail: host
 * callback credentials are NOT carried here — they are an adapter-construction
 * concern via `BrainAdapterFactory.forSession(...)` (MAR Contract Lock 1), so a
 * future non-Pi brain never inherits Pi's loopback-callback model.
 */
export interface BrainEvent {
  readonly kind: string
  readonly at: string
  readonly data?: Record<string, unknown>
}

export interface BrainRunInput {
  readonly intent: string
  readonly tools: readonly string[]
  readonly systemPrompt: string
  readonly signal?: AbortSignal
  readonly onEvent: (event: BrainEvent) => void
}

export interface BrainResult {
  readonly status: 'completed' | 'cancelled' | 'error'
  readonly summary?: string
  readonly proposalId?: string
  readonly adhocRouteId?: string
  readonly error?: string
}

export interface BrainAdapter {
  runSession(input: BrainRunInput): Promise<BrainResult>
}

/**
 * Mints a per-run adapter configured with the loopback callback credentials for
 * one agent session. `agent.author` calls this AFTER minting the scoped token,
 * passing that scoped token (never the host token). `FakeBrainAdapter` ignores
 * the credentials; `PiCliBrainAdapter` injects them into the Pi child env.
 */
export interface BrainAdapterFactory {
  forSession(conn: { hostUrl: string; hostToken: string }): BrainAdapter
}
