export interface IClock {
  nowUnix(): number
}

export interface IIdGenerator {
  nextId(): string
}

export const WaypointSubjectType = {
  Project: 'waypoint_project',
  Workstream: 'waypoint_workstream',
  Milestone: 'waypoint_milestone',
  Phase: 'waypoint_phase',
  Plan: 'waypoint_plan',
} as const

export type WaypointSubjectType = (typeof WaypointSubjectType)[keyof typeof WaypointSubjectType]
