import type { BrowserEngineClient } from '../engine/client'
import type { EngineEnvelope, EngineWsMessage } from '../engine/types'

/** Deterministic in-memory client for component tests. */
export class FakeEngineClient implements BrowserEngineClient {
  responses: Record<string, EngineEnvelope> = {}
  calls: { name: string; payload: unknown }[] = []
  private handlers: ((msg: EngineWsMessage) => void)[] = []

  async cmd(name: string, payload: unknown = {}): Promise<EngineEnvelope> {
    this.calls.push({ name, payload })
    return this.responses[name] ?? { ok: true, action: name }
  }

  subscribe(_topics: string[], onMessage: (msg: EngineWsMessage) => void): () => void {
    this.handlers.push(onMessage)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== onMessage)
    }
  }

  /** Push a WS message to all current subscribers. */
  emit(msg: EngineWsMessage): void {
    for (const handler of this.handlers) handler(msg)
  }
}
