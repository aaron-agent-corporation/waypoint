import type {
  BrainAdapter,
  BrainAdapterFactory,
  BrainEvent,
  BrainResult,
  BrainRunInput,
} from './brain-adapter.ts'

export interface FakeBrainScript {
  readonly events: readonly BrainEvent[]
  readonly result: BrainResult
  /** Awaited before the terminal result — lets cancel tests interrupt a still-running session. */
  readonly gate?: Promise<void>
  /** Fired before each emit (e.g. to trigger a mid-run abort). */
  readonly onBeforeEmit?: () => void
}

/**
 * Deterministic test double. Emits its scripted events (honoring abort), then —
 * after an optional `gate` resolves — returns its scripted result, or
 * `cancelled` if the signal aborted. Ignores host credentials by design.
 */
export class FakeBrainAdapter implements BrainAdapter, BrainAdapterFactory {
  private readonly script: FakeBrainScript

  constructor(script: FakeBrainScript) {
    this.script = script
  }

  /** A FakeBrainAdapter is its own factory — the same script for any session. */
  forSession(): BrainAdapter {
    return this
  }

  async runSession(input: BrainRunInput): Promise<BrainResult> {
    for (const event of this.script.events) {
      this.script.onBeforeEmit?.()
      if (input.signal?.aborted) return { status: 'cancelled' }
      input.onEvent(event)
    }
    if (this.script.gate) await this.script.gate
    if (input.signal?.aborted) return { status: 'cancelled' }
    return this.script.result
  }
}
