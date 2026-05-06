import type { WaypointSubjectType } from './system'

export interface WaypointRouteRecord {
  id: number
  projectId: number
  subjectType: WaypointSubjectType
  subjectId: number
  status: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
}

export interface WaypointEventRecord {
  id: number
  routeId: number
  kind: string
  createdAt: number
  payload?: unknown
}

export interface IWaypointStore {
  getRouteById(routeId: number): Promise<WaypointRouteRecord | null>
  listRoutes(input: {
    projectId: number
    status?: WaypointRouteRecord['status']
    limit: number
    offset: number
  }): Promise<{ items: WaypointRouteRecord[]; total: number }>
  appendRouteEvent(input: {
    routeId: number
    kind: string
    payload?: unknown
    createdAt: number
  }): Promise<WaypointEventRecord>
}
