export type WaypointDiscussionAuthor = 'user' | 'agent'

export interface AppendTaskDiscussionMessageInput {
  readonly author?: WaypointDiscussionAuthor
  readonly content: string
  readonly now?: Date
}

export interface WaypointTaskDiscussionMessage {
  readonly id: string
  readonly task_id: string
  readonly route_id: string
  readonly author: WaypointDiscussionAuthor
  readonly content: string
  readonly created_at: string
  readonly metadata: Record<string, unknown>
}

export interface TaskDiscussionMessagePage {
  readonly task_id: string
  readonly total: number
  readonly items: readonly WaypointTaskDiscussionMessage[]
}
