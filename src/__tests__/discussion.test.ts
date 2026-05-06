import { describe, expect, it } from 'vitest'
import {
  resolveWaypointDiscussionAutoResponse,
  parseWaypointDiscussionAutoResponseEnvFlag,
  parseWaypointTaskDiscussionMetadata,
  mergeWaypointTaskDiscussionMetadata,
  isWaypointTaskDiscussionEnabled,
  resolveWaypointTaskDiscussionStatus,
  resolveWaypointTaskDiscussionAgent,
  normalizeWaypointTaskDiscussionListLimit,
  normalizeWaypointTaskDiscussionMessageContent,
} from '../discussion/metadata'

describe('waypoint-core contract: discussion auto-response gating', () => {
  it('returns metadata_disabled when metadata opt-in is false', () => {
    expect(
      resolveWaypointDiscussionAutoResponse({
        metadataOptIn: false,
        globalOptIn: true,
        agent: 'planner',
      }),
    ).toEqual({ requested: false, agent: 'planner', reason: 'metadata_disabled' })
  })

  it('returns global_disabled when env gate is off', () => {
    expect(
      resolveWaypointDiscussionAutoResponse({
        metadataOptIn: true,
        globalOptIn: false,
        agent: 'planner',
      }),
    ).toEqual({ requested: false, agent: 'planner', reason: 'global_disabled' })
  })

  it('returns missing_agent when agent is empty/whitespace', () => {
    expect(
      resolveWaypointDiscussionAutoResponse({
        metadataOptIn: true,
        globalOptIn: true,
        agent: '   ',
      }),
    ).toEqual({ requested: false, reason: 'missing_agent' })
  })

  it('requests auto-response when both gates open and agent present', () => {
    expect(
      resolveWaypointDiscussionAutoResponse({
        metadataOptIn: true,
        globalOptIn: true,
        agent: 'planner',
      }),
    ).toEqual({ requested: true, agent: 'planner' })
  })
})

describe('waypoint-core contract: discussion env flag parser', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'On', '  true  '])('accepts truthy env flag %s', value => {
    expect(parseWaypointDiscussionAutoResponseEnvFlag(value)).toBe(true)
  })

  it.each(['0', 'false', 'no', 'off', '', '   ', 'garbage'])('rejects falsy env flag %s', value => {
    expect(parseWaypointDiscussionAutoResponseEnvFlag(value)).toBe(false)
  })

  it('rejects undefined/null', () => {
    expect(parseWaypointDiscussionAutoResponseEnvFlag(undefined)).toBe(false)
    expect(parseWaypointDiscussionAutoResponseEnvFlag(null)).toBe(false)
  })
})

describe('waypoint-core contract: discussion metadata helpers', () => {
  it('returns enabled=false on invalid json', () => {
    expect(parseWaypointTaskDiscussionMetadata('{not json')).toEqual({ enabled: false })
  })

  it('detects discussion enabled flag in nested metadata', () => {
    expect(isWaypointTaskDiscussionEnabled({ waypoint: { discussion: { enabled: true } } })).toBe(true)
    expect(isWaypointTaskDiscussionEnabled({})).toBe(false)
  })

  it('merges discussion metadata while preserving unrelated keys', () => {
    expect(
      mergeWaypointTaskDiscussionMetadata(
        { other: true },
        { enabled: true, conversation_id: 'task:5:discussion:agent', status: 'active' },
      ),
    ).toMatchObject({
      other: true,
      waypoint: {
        discussion: {
          enabled: true,
          conversation_id: 'task:5:discussion:agent',
          status: 'active',
          mode: 'agent_chat',
        },
      },
    })
  })

  it('resolves discussion status with defaults and preservation', () => {
    expect(resolveWaypointTaskDiscussionStatus('closed')).toBe('closed')
    expect(resolveWaypointTaskDiscussionStatus('summarized')).toBe('summarized')
    expect(resolveWaypointTaskDiscussionStatus('active')).toBe('active')
    expect(resolveWaypointTaskDiscussionStatus(undefined)).toBe('active')
  })

  it('resolves discussion agent with requested/existing/assigned fallback', () => {
    expect(resolveWaypointTaskDiscussionAgent({ requestedAgent: '  ops-agent  ' })).toBe('ops-agent')
    expect(resolveWaypointTaskDiscussionAgent({ requestedAgent: '   ', existingAgent: 'reviewer' })).toBe('reviewer')
    expect(resolveWaypointTaskDiscussionAgent({ existingAgent: '', assignedTo: 'planner' })).toBe('planner')
    expect(resolveWaypointTaskDiscussionAgent({})).toBe('agent')
  })

  it('clamps discussion list limit within bounds', () => {
    expect(normalizeWaypointTaskDiscussionListLimit(undefined)).toBe(100)
    expect(normalizeWaypointTaskDiscussionListLimit(0)).toBe(1)
    expect(normalizeWaypointTaskDiscussionListLimit(999)).toBe(200)
    expect(normalizeWaypointTaskDiscussionListLimit(50)).toBe(50)
  })

  it('normalizes discussion message content by trimming', () => {
    expect(normalizeWaypointTaskDiscussionMessageContent('   hi   ')).toBe('hi')
    expect(normalizeWaypointTaskDiscussionMessageContent('')).toBe('')
  })
})
