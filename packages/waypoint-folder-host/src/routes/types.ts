export type WaypointFolderRouteStatus = 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'

export interface WaypointFolderRouteSubject {
  readonly type: string
  readonly id: string
}

export interface WaypointFolderRoute {
  readonly id: string
  readonly quest: string
  readonly status: WaypointFolderRouteStatus
  readonly current_node: string | null
  readonly subject: WaypointFolderRouteSubject
  readonly created_at: string
  readonly updated_at: string
  readonly metadata?: Record<string, unknown>
}

export interface CreateWaypointRouteInput {
  readonly quest: string
  readonly subject: WaypointFolderRouteSubject
  readonly current_node?: string | null
  readonly status?: WaypointFolderRouteStatus
  readonly metadata?: Record<string, unknown>
  readonly now?: Date
}
