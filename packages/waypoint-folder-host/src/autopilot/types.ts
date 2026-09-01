export type WaypointAutopilotRunStatus = 'complete' | 'blocked' | 'iteration_cap' | 'failed' | 'cancelled'

export interface WaypointAutopilotRunRecord {
  readonly id: string
  readonly route_id: string
  readonly status: WaypointAutopilotRunStatus
  readonly iterations: number
  readonly completed_tasks: readonly string[]
  readonly blocked_node: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly metadata?: Record<string, unknown>
}

export interface WaypointAutopilotRunPage {
  readonly items: readonly WaypointAutopilotRunRecord[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface RunWaypointAutopilotOptions {
  readonly routeId?: string
  readonly maxIterations?: number
  readonly now?: Date
  /** Resolve recipe manifests from this catalog dir (session overlay) instead of `.waypoint/recipes`. */
  readonly catalogDir?: string
  /** Aborts the in-flight recipe child and ends the run `cancelled`. */
  readonly signal?: AbortSignal
}

export interface RunWaypointAutopilotResult {
  readonly run: WaypointAutopilotRunRecord
  readonly status: WaypointAutopilotRunStatus
  readonly routeId: string
  readonly iterations: number
  readonly completedTasks: readonly string[]
  readonly blockedNode: string | null
}
