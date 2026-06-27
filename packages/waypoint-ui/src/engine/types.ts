import type { AgentEventRecord, EngineEnvelope, EngineEvent } from '@waypoint/engine-host'
import type {
  CatalogRecipeManifest,
  RouteEventPage,
  WaypointFolderRoute,
  WaypointFolderRouteEvent,
  WaypointFolderTask,
  WaypointFolderTaskKind,
  WaypointFolderTaskStatus,
} from '@waypoint/folder-host'

export type {
  AgentEventRecord,
  CatalogRecipeManifest,
  EngineEnvelope,
  EngineEvent,
  RouteEventPage,
  WaypointFolderRoute,
  WaypointFolderRouteEvent,
  WaypointFolderTask,
  WaypointFolderTaskKind,
  WaypointFolderTaskStatus,
}

/** Messages the engine WS pushes (see engine-host transport/http-ws/ws.ts). */
export type EngineWsMessage =
  | { type: 'snapshot'; apiVersion: string; seq: number; routes: WaypointFolderRoute[]; tasks: WaypointFolderTask[] }
  | { type: 'event'; topic: string; seq: number; record: unknown }
  | { type: 'resnapshot' }
  | { type: 'error'; error: string }

/** Shape of an entry from `agent.list`. */
export interface AgentSessionSummary {
  readonly id: string
  readonly intent: string
  readonly status: string
  readonly startedAt: string
}
