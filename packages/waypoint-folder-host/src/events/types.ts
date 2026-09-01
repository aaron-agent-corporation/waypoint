export interface WaypointFolderRouteEvent {
  readonly id: string
  readonly route_id: string
  readonly kind: string
  readonly created_at: string
  readonly payload?: unknown
}

export interface AppendRouteEventInput {
  readonly kind: string
  readonly payload?: unknown
  readonly now?: Date
}

export interface RouteEventPage {
  readonly items: readonly WaypointFolderRouteEvent[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface ReadRouteEventsOptions {
  readonly limit?: number
  readonly offset?: number
}
