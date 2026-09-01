export interface IClock {
  nowUnix(): number
}

export interface IIdGenerator {
  nextId(): string
}

export const WaypointSubjectType = {
  Project: 'runner_project',
  Workstream: 'runner_workstream',
  Milestone: 'runner_milestone',
  Phase: 'runner_phase',
  Plan: 'runner_plan',
} as const

export type WaypointSubjectType = (typeof WaypointSubjectType)[keyof typeof WaypointSubjectType]
