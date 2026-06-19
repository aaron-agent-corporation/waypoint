import { EngineError, fail } from '../envelope.ts'
import type { EngineEnvelope } from '../types.ts'

/**
 * Per-dispatch context. `allow` is the scoped-token grant the bus enforces;
 * `agentSessionId` is the authoritative session owner (from the scoped token,
 * never the payload — MAR Contract Lock 3); `signal` aborts long-running work.
 */
export interface DispatchContext {
  readonly allow?: ReadonlySet<string>
  readonly agentSessionId?: string
  readonly signal?: AbortSignal
}

export type CommandHandler = (
  payload: unknown,
  ctx?: DispatchContext,
) => Promise<EngineEnvelope> | EngineEnvelope

/**
 * Transport-agnostic command registry. Handlers return success envelopes (or
 * throw); `dispatch` normalizes every failure into a coded error envelope:
 * `EngineError` → its own code/details, any other throw → `BACKEND_ERROR`,
 * unknown command → `UNKNOWN_COMMAND`, out-of-scope command → `FORBIDDEN`
 * (denied before the handler ever runs).
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

  async dispatch(name: string, payload: unknown, ctx?: DispatchContext): Promise<EngineEnvelope> {
    const handler = this.handlers.get(name)
    if (!handler) return fail(`Unknown command: ${name}`, { code: 'UNKNOWN_COMMAND' })
    if (ctx?.allow && !ctx.allow.has(name)) {
      return fail(`Command not in session grant: ${name}`, { code: 'FORBIDDEN', field: 'command' })
    }
    try {
      return await handler(payload, ctx)
    } catch (error) {
      if (error instanceof EngineError) return fail(error.message, error.details)
      return fail(error instanceof Error ? error.message : String(error), { code: 'BACKEND_ERROR' })
    }
  }
}
