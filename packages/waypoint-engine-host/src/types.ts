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

export interface EngineEvent {
  readonly seq: number
  readonly topic: string
  readonly record: WaypointFolderRouteEvent
}
