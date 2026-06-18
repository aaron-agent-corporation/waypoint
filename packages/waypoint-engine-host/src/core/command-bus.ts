import { EngineError, fail } from '../envelope.ts'
import type { EngineEnvelope } from '../types.ts'

export type CommandHandler = (payload: unknown) => Promise<EngineEnvelope> | EngineEnvelope

/**
 * Transport-agnostic command registry. Handlers return success envelopes (or
 * throw); `dispatch` normalizes every failure into a coded error envelope:
 * `EngineError` → its own code/details, any other throw → `BACKEND_ERROR`,
 * unknown command → `UNKNOWN_COMMAND`.
 */
export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler>()

  register(name: string, handler: CommandHandler): void {
    if (this.handlers.has(name)) throw new Error(`Command already registered: ${name}`)
    this.handlers.set(name, handler)
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  names(): string[] {
    return [...this.handlers.keys()].sort()
  }

  async dispatch(name: string, payload: unknown): Promise<EngineEnvelope> {
    const handler = this.handlers.get(name)
    if (!handler) return fail(`Unknown command: ${name}`, { code: 'UNKNOWN_COMMAND' })
    try {
      return await handler(payload)
    } catch (error) {
      if (error instanceof EngineError) return fail(error.message, error.details)
      return fail(error instanceof Error ? error.message : String(error), { code: 'BACKEND_ERROR' })
    }
  }
}
