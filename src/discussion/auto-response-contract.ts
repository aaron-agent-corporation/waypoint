/**
 * Waypoint discussion auto-response contract.
 *
 * Shared types for the MC → Hermes auto-response webhook surface.
 * Kept in `@waypoint/core` so both sides of the wire reference the same shapes.
 *
 * Host adapters MUST NOT extend these types in ways that break wire compatibility
 * without bumping `schema_version`.
 */

/**
 * Who authored a discussion message.
 * - `'user'`  — authored by an interactive operator via normal auth.
 * - `'agent'` — authored by an automated agent (service-token path).
 */
export type WaypointDiscussionMessageAuthoredBy = 'user' | 'agent'

/**
 * Enumerated values for `WaypointDiscussionMessageAuthoredBy`.
 * Exported as a stable `readonly` array for runtime checks / schema generation.
 */
export const WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES = ['user', 'agent'] as const

/**
 * Runtime type guard for `WaypointDiscussionMessageAuthoredBy`.
 */
export function isWaypointDiscussionMessageAuthoredBy(
  value: unknown,
): value is WaypointDiscussionMessageAuthoredBy {
  return value === 'user' || value === 'agent'
}

/**
 * A single historical discussion message included in auto-response payloads
 * so the receiver does not need to round-trip back to MC for context.
 */
export interface WaypointDiscussionAutoResponseHistoryEntry {
  /** Host-local message id (opaque to core; host adapter assigns it). */
  id: number
  /** Authorship marker (`'user'` or `'agent'`). */
  authored_by: WaypointDiscussionMessageAuthoredBy
  /** Agent slug that authored this message, or `null` if user-authored. */
  agent: string | null
  /** Raw textual content of the message. */
  content: string
  /** Unix epoch seconds the message was created. */
  created_at: number
}

/**
 * The JSON body MC sends to Hermes (or any host-agnostic consumer) when a
 * discussion message triggers an auto-response request.
 *
 * `schema_version` is the compatibility hinge. Breaking changes MUST bump it.
 */
export interface WaypointDiscussionAutoResponseRequestPayload {
  /** Contract schema version. Current: `1`. */
  schema_version: 1
  /** Task id owning the discussion. */
  task_id: number
  /** Project id owning the task (host-agnostic routing key for MC). */
  project_id: number
  /**
   * Strict conversation id, e.g. `task:{task_id}:discussion:{agent_slug}`.
   * Receivers should treat this as opaque and round-trip it verbatim.
   */
  conversation_id: string
  /** Target agent slug (e.g. `'gsd-doc-drafter'`, `'orchestrator'`). */
  agent: string
  /** The newly-posted message content that triggered the auto-response. */
  content: string
  /** Authorship of the triggering message (always `'user'` for V1 flows). */
  authored_by: WaypointDiscussionMessageAuthoredBy
  /** Unix epoch seconds at which this auto-response was requested. */
  requested_at: number
  /**
   * Ordered prior discussion messages so the receiver has context without
   * re-fetching from MC. Oldest-first.
   */
  history: WaypointDiscussionAutoResponseHistoryEntry[]
}
