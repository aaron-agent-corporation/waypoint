import { makeErrorEnvelope } from '@waypoint/core'
import type { WaypointErrorEnvelope } from '@waypoint/core'

import type { EngineErrorDetails, EngineSuccessEnvelope } from './types.ts'

export { makeErrorEnvelope }

/** Build a success envelope: `{ ok: true, action, ...data }`. */
export function ok(action: string, data: Record<string, unknown> = {}): EngineSuccessEnvelope {
  return { ok: true, action, ...data }
}

/** Build a coded error envelope: `{ ok: false, action: 'error', error, details }`. */
export function fail(message: string, details: EngineErrorDetails): WaypointErrorEnvelope {
  return makeErrorEnvelope(message, details)
}

/**
 * Error thrown inside command handlers; the CommandBus (Task 3) maps it to a
 * coded `fail()` envelope so handlers can `throw new EngineError(msg, { code })`
 * instead of constructing envelopes inline.
 */
export class EngineError extends Error {
  readonly details: EngineErrorDetails

  constructor(message: string, details: EngineErrorDetails) {
    super(message)
    this.name = 'EngineError'
    this.details = details
  }
}
