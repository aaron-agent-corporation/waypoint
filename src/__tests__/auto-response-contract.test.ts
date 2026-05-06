import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES,
  isWaypointDiscussionMessageAuthoredBy,
  type WaypointDiscussionAutoResponseRequestPayload,
  type WaypointDiscussionMessageAuthoredBy,
} from '../discussion/auto-response-contract'

describe('@waypoint/core discussion/auto-response-contract', () => {
  it('exposes the authored-by enum values', () => {
    expect(new Set(WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES)).toEqual(
      new Set(['user', 'agent']),
    )
  })

  it('type-guards valid authored-by values', () => {
    expect(isWaypointDiscussionMessageAuthoredBy('user')).toBe(true)
    expect(isWaypointDiscussionMessageAuthoredBy('agent')).toBe(true)
    expect(isWaypointDiscussionMessageAuthoredBy('system')).toBe(false)
    expect(isWaypointDiscussionMessageAuthoredBy(null)).toBe(false)
    expect(isWaypointDiscussionMessageAuthoredBy(undefined)).toBe(false)
    expect(isWaypointDiscussionMessageAuthoredBy(42)).toBe(false)
  })

  it('exposes a stable auto-response request payload shape', () => {
    const payload: WaypointDiscussionAutoResponseRequestPayload = {
      schema_version: 1,
      task_id: 123,
      project_id: 42,
      conversation_id: 'task:123:discussion:gsd-doc-drafter',
      agent: 'gsd-doc-drafter',
      content: 'Please clarify the acceptance criteria.',
      authored_by: 'user',
      requested_at: 1777720000,
      history: [
        {
          id: 1,
          authored_by: 'user',
          agent: null,
          content: 'Hi',
          created_at: 1777719000,
        },
      ],
    }

    // Required shape present
    expect(payload.schema_version).toBe(1)
    expect(payload.task_id).toBe(123)
    expect(payload.conversation_id).toBe('task:123:discussion:gsd-doc-drafter')
    expect(payload.authored_by).toBe('user')

    // Field type assertions (compile-time)
    expectTypeOf(payload.authored_by).toEqualTypeOf<WaypointDiscussionMessageAuthoredBy>()
    expectTypeOf(payload.history).toEqualTypeOf<
      WaypointDiscussionAutoResponseRequestPayload['history']
    >()
  })

  it('supports agent-authored history entries', () => {
    const payload: WaypointDiscussionAutoResponseRequestPayload = {
      schema_version: 1,
      task_id: 7,
      project_id: 2,
      conversation_id: 'task:7:discussion:orchestrator',
      agent: 'orchestrator',
      content: 'thanks',
      authored_by: 'user',
      requested_at: 1,
      history: [
        { id: 10, authored_by: 'agent', agent: 'orchestrator', content: 'hi', created_at: 0 },
      ],
    }

    expect(payload.history[0].authored_by).toBe('agent')
    expect(payload.history[0].agent).toBe('orchestrator')
  })
})
