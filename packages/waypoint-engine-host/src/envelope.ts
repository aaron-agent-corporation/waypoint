import { makeErrorEnvelope } from '@waypoint/core'
import type { WaypointErrorEnvelope } from '@waypoint/core'

import type { EngineErrorDetails, EngineSuccessEnvelope } from './types.ts'

export { makeErrorEnvelope }

/** Build a success envelope: `{ ok: true, action, ...data }`. */
export function ok(action: string, data: Record<string, unknown> = {}): EngineSuccessEnvelope {
  return { ok: true, action, ...data }
}

/**
 * Build a coded error envelope with the ONE canonical details shape every
 * consumer (and the AI agent) can parse: `{ ok:false, action:'error', error,
 * details: { code, path?, message, issues? } }`. Handlers still throw the
 * ergonomic `{ code, field, issues }` (EngineErrorDetails); `field` is mapped to
 * `path` and the human `message` is mirrored into details here (Task 10 / DX
 * decisions 18-19).
 */
export function fail(message: string, details: EngineErrorDetails): WaypointErrorEnvelope {
  return makeErrorEnvelope(message, canonicalErrorDetails(message, details))
}

export interface CanonicalErrorDetails {
  readonly code: string
  readonly path?: string
  readonly message: string
  readonly issues?: readonly string[]
}

function canonicalErrorDetails(message: string, details: EngineErrorDetails): CanonicalErrorDetails {
  return {
    code: details.code,
    ...(details.field !== undefined ? { path: details.field } : {}),
    message,
    ...(details.issues !== undefined ? { issues: details.issues } : {}),
  }
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
