export interface LifecycleTimestampedRecord {
  readonly created_at: string
  readonly updated_at: string
}

export interface LifecycleWorkstream extends LifecycleTimestampedRecord {
  readonly id: string
  readonly key: string
  readonly name: string
}

export interface LifecycleMilestone extends LifecycleTimestampedRecord {
  readonly id: string
  readonly workstream: string
  readonly key: string
  readonly title: string
}

export interface LifecyclePhase extends LifecycleTimestampedRecord {
  readonly id: string
  readonly milestone: string
  readonly key: string
  readonly lifecycle: string
}

export interface LifecyclePlan extends LifecycleTimestampedRecord {
  readonly id: string
  readonly phase: string
  readonly ref: string
  readonly title: string
  readonly status: 'pending'
}

export interface LifecycleState {
  readonly workstreams: readonly LifecycleWorkstream[]
  readonly milestones: readonly LifecycleMilestone[]
  readonly phases: readonly LifecyclePhase[]
  readonly plans: readonly LifecyclePlan[]
}

export interface AddLifecycleWorkstreamInput {
  readonly key: string
  readonly name: string
  readonly now?: Date
}

export interface AddLifecycleMilestoneInput {
  readonly workstream: string
  readonly key: string
  readonly title: string
  readonly now?: Date
}

export interface AddLifecyclePhaseInput {
  readonly milestone: string
  readonly key: string
  readonly lifecycle: string
  readonly now?: Date
}

export interface AddLifecyclePlanInput {
  readonly phase: string
  readonly ref: string
  readonly title: string
  readonly now?: Date
}
