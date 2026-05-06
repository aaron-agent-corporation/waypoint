import { describe, it, expect } from 'vitest'
import {
  buildWaypointRouteKey,
  normalizeWaypointScope,
  isWaypointSubjectType,
  hasWaypointAutopilotProgress,
  WAYPOINT_SUBJECT_TYPES,
  WAYPOINT_COMPAT_SUBJECT_TYPES,
} from '../index'

describe('buildWaypointRouteKey', () => {
  it('builds a stable colon-joined route key with a v-prefixed version', () => {
    const key = buildWaypointRouteKey({
      subjectType: WAYPOINT_SUBJECT_TYPES.plan,
      subjectId: 42,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
    expect(key).toBe('waypoint:waypoint_plan:42:waypoint-plan-execution:v1')
  })

  it('accepts string subject ids and numeric versions uniformly', () => {
    const key = buildWaypointRouteKey({
      subjectType: WAYPOINT_SUBJECT_TYPES.project,
      subjectId: '7',
      definitionSlug: 'waypoint-doctor',
      definitionVersion: 2,
    })
    expect(key).toBe('waypoint:waypoint_project:7:waypoint-doctor:v2')
  })

  it('does not double-prefix versions that already start with v', () => {
    const key = buildWaypointRouteKey({
      subjectType: WAYPOINT_SUBJECT_TYPES.project,
      subjectId: 1,
      definitionSlug: 'waypoint-forensics',
      definitionVersion: 'v3',
    })
    expect(key).toBe('waypoint:waypoint_project:1:waypoint-forensics:v3')
  })
})

describe('normalizeWaypointScope', () => {
  it('returns scope ids from vars when provided', () => {
    const scope = normalizeWaypointScope({
      subjectType: WAYPOINT_SUBJECT_TYPES.plan,
      subjectId: 1,
      vars: {
        project_id: 11,
        workstream_id: '22',
        milestone_id: 33,
        phase_id: 44,
        plan_id: 55,
      },
    })
    expect(scope).toEqual({
      projectId: 11,
      workstreamId: 22,
      milestoneId: 33,
      phaseId: 44,
      planId: 55,
    })
  })

  it('falls back to subject id for the matching scope level when vars are missing', () => {
    const scope = normalizeWaypointScope({
      subjectType: WAYPOINT_SUBJECT_TYPES.project,
      subjectId: 99,
    })
    expect(scope.projectId).toBe(99)
    expect(scope.workstreamId).toBe(null)
    expect(scope.milestoneId).toBe(null)
    expect(scope.phaseId).toBe(null)
    expect(scope.planId).toBe(null)
  })

  it('treats compat gsd_* subject types as valid waypoint subjects', () => {
    const scope = normalizeWaypointScope({
      subjectType: WAYPOINT_COMPAT_SUBJECT_TYPES.phase,
      subjectId: '7',
    })
    expect(scope.phaseId).toBe(7)
  })

  it('rejects unsupported subject types', () => {
    expect(() =>
      normalizeWaypointScope({
        subjectType: 'not-a-waypoint-subject',
        subjectId: 1,
      }),
    ).toThrow(/Unsupported Waypoint subject type/)
  })
})

describe('isWaypointSubjectType', () => {
  it('accepts both waypoint_* and compat gsd_* subject types', () => {
    for (const value of Object.values(WAYPOINT_SUBJECT_TYPES)) {
      expect(isWaypointSubjectType(value)).toBe(true)
    }
    for (const value of Object.values(WAYPOINT_COMPAT_SUBJECT_TYPES)) {
      expect(isWaypointSubjectType(value)).toBe(true)
    }
  })

  it('rejects unrelated strings', () => {
    expect(isWaypointSubjectType('random_subject')).toBe(false)
  })
})

describe('hasWaypointAutopilotProgress', () => {
  it('returns true when any timer completed', () => {
    expect(
      hasWaypointAutopilotProgress({ timerCompleted: ['t1'], createdCounts: [] }),
    ).toBe(true)
  })

  it('returns true when any created count is positive', () => {
    expect(
      hasWaypointAutopilotProgress({ timerCompleted: [], createdCounts: [0, 0, 2] }),
    ).toBe(true)
  })

  it('returns false when no timer and all created counts are zero', () => {
    expect(
      hasWaypointAutopilotProgress({ timerCompleted: [], createdCounts: [0, 0, 0] }),
    ).toBe(false)
  })

  it('returns false when both inputs are empty', () => {
    expect(
      hasWaypointAutopilotProgress({ timerCompleted: [], createdCounts: [] }),
    ).toBe(false)
  })
})
