export type WaypointErrorEnvelope = {
  ok: false
  action: 'error'
  error: string
  details?: unknown
}

export function makeErrorEnvelope(error: string, details?: unknown): WaypointErrorEnvelope {
  return {
    ok: false,
    action: 'error',
    error,
    ...(details !== undefined ? { details } : {}),
  }
}
