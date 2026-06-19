import type { WaypointErrorEnvelope } from '@waypoint/core'
import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'

export type EngineBackend = 'folder' | 'beads'

export type EngineErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'NO_WORKSPACE'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'BACKEND_ERROR'
  | 'CONFLICT'
  | 'FORBIDDEN'

export interface EngineErrorDetails {
  readonly code: EngineErrorCode
  readonly field?: string
  readonly issues?: readonly string[]
}

export interface EngineSuccessEnvelope {
  readonly ok: true
  readonly action: string
  readonly [key: string]: unknown
}

export type EngineEnvelope = EngineSuccessEnvelope | WaypointErrorEnvelope

/**
 * Agent turn/tool event republished onto the hub under an `agent:<sessionId>`
 * topic. `idx` is the restart-stable, transcript-relative replay cursor; `seq`
 * (on the wrapping EngineEvent) is the live hub cursor (MAR Contract Lock 4).
 */
export interface AgentEventRecord {
  readonly id: string
  readonly sessionId: string
  readonly kind: string
  readonly at: string
  readonly idx?: number
  readonly data?: Record<string, unknown>
}

export interface EngineEvent {
  readonly seq: number
  readonly topic: string
  readonly record: WaypointFolderRouteEvent | AgentEventRecord
}
