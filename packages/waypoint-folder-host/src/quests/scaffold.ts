import type { CatalogQuestManifest } from '../catalog/bundled.ts'
import {
  addLifecycleMilestone,
  addLifecyclePhase,
  addLifecyclePlan,
  addLifecycleWorkstream,
  listLifecycleState,
} from '../lifecycle/store.ts'

export interface ApplyQuestScaffoldOptions {
  readonly quest: CatalogQuestManifest | { readonly scaffolds?: unknown }
  readonly now?: Date
}

export interface AppliedQuestScaffoldSummary {
  readonly workstreams: number
  readonly milestones: number
  readonly phases: number
  readonly plans: number
}

interface NormalizedQuestScaffolds {
  readonly workstreams: readonly NormalizedWorkstream[]
}

interface NormalizedWorkstream {
  readonly key: string
  readonly name: string
  readonly milestones: readonly NormalizedMilestone[]
}

interface NormalizedMilestone {
  readonly key: string
  readonly title: string
  readonly phases: readonly NormalizedPhase[]
}

interface NormalizedPhase {
  readonly key: string
  readonly lifecycle: string
  readonly plans: readonly NormalizedPlan[]
}

interface NormalizedPlan {
  readonly ref: string
  readonly title: string
}

export async function applyQuestScaffold(
  projectRoot: string,
  options: ApplyQuestScaffoldOptions,
): Promise<AppliedQuestScaffoldSummary> {
  const scaffolds = normalizeQuestScaffolds(options.quest.scaffolds)
  const summary = countScaffoldEntries(scaffolds)

  for (const workstream of scaffolds.workstreams) {
    const state = await listLifecycleState(projectRoot)
    if (!state.workstreams.some((entry) => entry.key === workstream.key)) {
      await addLifecycleWorkstream(projectRoot, { key: workstream.key, name: workstream.name, now: options.now })
    }

    for (const milestone of workstream.milestones) {
      const afterWorkstream = await listLifecycleState(projectRoot)
      if (!afterWorkstream.milestones.some((entry) => entry.key === milestone.key)) {
        await addLifecycleMilestone(projectRoot, {
          workstream: workstream.key,
          key: milestone.key,
          title: milestone.title,
          now: options.now,
        })
      }

      for (const phase of milestone.phases) {
        const afterMilestone = await listLifecycleState(projectRoot)
        if (!afterMilestone.phases.some((entry) => entry.key === phase.key)) {
          await addLifecyclePhase(projectRoot, {
            milestone: milestone.key,
            key: phase.key,
            lifecycle: phase.lifecycle,
            now: options.now,
          })
        }

        for (const plan of phase.plans) {
          const afterPhase = await listLifecycleState(projectRoot)
          if (!afterPhase.plans.some((entry) => entry.ref === plan.ref)) {
            await addLifecyclePlan(projectRoot, {
              phase: phase.key,
              ref: plan.ref,
              title: plan.title,
              now: options.now,
            })
          }
        }
      }
    }
  }

  return summary
}

function normalizeQuestScaffolds(scaffolds: unknown): NormalizedQuestScaffolds {
  if (!isRecord(scaffolds) || !Array.isArray(scaffolds.workstreams)) return { workstreams: [] }
  return { workstreams: scaffolds.workstreams.map(normalizeWorkstream).filter(isPresent) }
}

function normalizeWorkstream(value: unknown): NormalizedWorkstream | null {
  if (!isRecord(value) || typeof value.key !== 'string') return null
  const milestones = Array.isArray(value.milestones) ? value.milestones.map(normalizeMilestone).filter(isPresent) : []
  return {
    key: value.key,
    name: typeof value.name === 'string' ? value.name : value.key,
    milestones,
  }
}

function normalizeMilestone(value: unknown): NormalizedMilestone | null {
  if (!isRecord(value) || typeof value.version_label !== 'string') return null
  const phases = Array.isArray(value.phases) ? value.phases.map(normalizePhase).filter(isPresent) : []
  return {
    key: value.version_label,
    title: typeof value.title === 'string' ? value.title : value.version_label,
    phases,
  }
}

function normalizePhase(value: unknown): NormalizedPhase | null {
  if (!isRecord(value) || typeof value.phase_slug !== 'string') return null
  const plans = Array.isArray(value.plans) ? value.plans.map(normalizePlan).filter(isPresent) : []
  return {
    key: value.phase_slug,
    lifecycle: typeof value.lifecycle_phase === 'string' ? value.lifecycle_phase : value.phase_slug,
    plans,
  }
}

function normalizePlan(value: unknown): NormalizedPlan | null {
  if (!isRecord(value) || typeof value.plan_ref !== 'string') return null
  return {
    ref: value.plan_ref,
    title: typeof value.title === 'string' ? value.title : value.plan_ref,
  }
}

function countScaffoldEntries(scaffolds: NormalizedQuestScaffolds): AppliedQuestScaffoldSummary {
  let milestones = 0
  let phases = 0
  let plans = 0
  for (const workstream of scaffolds.workstreams) {
    milestones += workstream.milestones.length
    for (const milestone of workstream.milestones) {
      phases += milestone.phases.length
      for (const phase of milestone.phases) {
        plans += phase.plans.length
      }
    }
  }
  return { workstreams: scaffolds.workstreams.length, milestones, phases, plans }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
