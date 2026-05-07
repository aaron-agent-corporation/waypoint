export type WaypointFolderTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done'
export type WaypointFolderTaskKind = 'recipe' | 'discussion' | 'gate'

export interface WaypointFolderTask {
  readonly id: string
  readonly route_id: string
  readonly plan_ref: string
  readonly title: string
  readonly phase: string
  readonly wave: number | null
  readonly kind: WaypointFolderTaskKind
  readonly status: WaypointFolderTaskStatus
  readonly created_at: string
  readonly updated_at: string
  readonly metadata?: Record<string, unknown>
}

export interface WaypointFolderTaskState {
  readonly tasks: readonly WaypointFolderTask[]
}
