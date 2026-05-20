export interface NormalizeWaypointScopeInput {
  subjectType: string
  subjectId: string | number
  vars?: Record<string, unknown> | null
}

export interface WaypointScope {
  projectId: number | null
  workstreamId: number | null
  milestoneId: number | null
  phaseId: number | null
  planId: number | null
}

export const WAYPOINT_SUBJECT_TYPES = {
  project: 'waypoint_project',
  workstream: 'waypoint_workstream',
  milestone: 'waypoint_milestone',
  phase: 'waypoint_phase',
  plan: 'waypoint_plan',
} as const

export const WAYPOINT_COMPAT_SUBJECT_TYPES = {
  project: 'gsd_project',
  workstream: 'gsd_workstream',
  milestone: 'gsd_milestone',
  phase: 'gsd_phase',
  plan: 'gsd_plan',
} as const

const waypointSubjectTypeValues = new Set<string>([
  ...Object.values(WAYPOINT_SUBJECT_TYPES),
  ...Object.values(WAYPOINT_COMPAT_SUBJECT_TYPES),
])

export function isWaypointSubjectType(value: string): boolean {
  return waypointSubjectTypeValues.has(value)
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function subjectTypeIs(input: string, key: keyof typeof WAYPOINT_SUBJECT_TYPES): boolean {
  return input === WAYPOINT_SUBJECT_TYPES[key] || input === WAYPOINT_COMPAT_SUBJECT_TYPES[key]
}

export function normalizeWaypointScope(input: NormalizeWaypointScopeInput): WaypointScope {
  if (!isWaypointSubjectType(input.subjectType)) {
    throw new Error(`Unsupported Waypoint subject type: ${input.subjectType}`)
  }

  const vars = input.vars ?? {}
  const subjectId = numeric(input.subjectId)

  return {
    projectId: numeric(vars.project_id) ?? (subjectTypeIs(input.subjectType, 'project') ? subjectId : null),
    workstreamId: numeric(vars.workstream_id) ?? (subjectTypeIs(input.subjectType, 'workstream') ? subjectId : null),
    milestoneId: numeric(vars.milestone_id) ?? (subjectTypeIs(input.subjectType, 'milestone') ? subjectId : null),
    phaseId: numeric(vars.phase_id) ?? (subjectTypeIs(input.subjectType, 'phase') ? subjectId : null),
    planId: numeric(vars.plan_id) ?? (subjectTypeIs(input.subjectType, 'plan') ? subjectId : null),
  }
}
