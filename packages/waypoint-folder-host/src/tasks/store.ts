import { buildWaypointTaskDiscussionConversationId } from '@waypoint/core'

import { insertWaypointTasksPg, listWaypointTasksPg, updateWaypointTaskPg } from '../postgres/store.ts'

import type { WaypointFolderRoute } from '../routes/types.ts'
import type { WaypointFolderTask, WaypointFolderTaskKind } from './types.ts'

export interface MaterializeQuestTasksOptions {
  readonly route: WaypointFolderRoute
  readonly quest: { readonly scaffolds?: unknown }
  readonly now?: Date
}

export async function materializeQuestTasks(
  projectRoot: string,
  options: MaterializeQuestTasksOptions,
): Promise<readonly WaypointFolderTask[]> {
  const existing = await listWaypointTasks(projectRoot)
  const existingForRoute = existing.filter((task) => task.route_id === options.route.id)
  if (existingForRoute.length > 0) return existingForRoute

  const timestamp = timestampFor(options.now)
  const plans = extractScaffoldPlans(options.quest.scaffolds)
  const nextNumber = existing.length + 1
  const tasks = plans.map((plan, index): WaypointFolderTask => ({
    id: `task-${String(nextNumber + index).padStart(3, '0')}`,
    route_id: options.route.id,
    plan_ref: plan.plan_ref,
    title: plan.title,
    phase: plan.phase,
    wave: plan.wave,
    kind: taskKindFor(plan.metadata),
    status: 'open',
    created_at: timestamp,
    updated_at: timestamp,
    ...(taskMetadataFor(nextNumber + index, plan.metadata) ? { metadata: taskMetadataFor(nextNumber + index, plan.metadata) } : {}),
  }))

  await insertWaypointTasksPg(projectRoot, tasks)
  return tasks
}

export async function listWaypointTasks(projectRoot: string): Promise<WaypointFolderTask[]> {
  return listWaypointTasksPg(projectRoot)
}

export async function getWaypointTask(projectRoot: string, taskId: string): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointTasks(projectRoot)
  return tasks.find((task) => task.id === taskId) ?? null
}

export async function updateWaypointTask(
  projectRoot: string,
  taskId: string,
  patch: Partial<Pick<WaypointFolderTask, 'status' | 'updated_at' | 'metadata'>>,
): Promise<WaypointFolderTask> {
  return updateWaypointTaskPg(projectRoot, taskId, patch)
}

export interface ScaffoldPlan {
  readonly phase: string
  readonly plan_ref: string
  readonly title: string
  readonly wave: number | null
  readonly metadata?: Record<string, unknown>
}

export function extractScaffoldPlans(scaffolds: unknown): ScaffoldPlan[] {
  const plans: ScaffoldPlan[] = []
  if (!isRecord(scaffolds) || !Array.isArray(scaffolds.workstreams)) return plans
  for (const workstream of scaffolds.workstreams) {
    if (!isRecord(workstream) || !Array.isArray(workstream.milestones)) continue
    for (const milestone of workstream.milestones) {
      if (!isRecord(milestone) || !Array.isArray(milestone.phases)) continue
      for (const phase of milestone.phases) {
        if (!isRecord(phase) || !Array.isArray(phase.plans)) continue
        const phaseSlug = typeof phase.phase_slug === 'string' ? phase.phase_slug : 'unknown'
        for (const plan of phase.plans) {
          if (!isRecord(plan) || typeof plan.plan_ref !== 'string' || typeof plan.title !== 'string') continue
          plans.push({
            phase: phaseSlug,
            plan_ref: plan.plan_ref,
            title: plan.title,
            wave: typeof plan.wave === 'number' ? plan.wave : null,
            ...(isRecord(plan.metadata) ? { metadata: plan.metadata } : {}),
          })
        }
      }
    }
  }
  return plans
}

export function taskKindFor(metadata: Record<string, unknown> | undefined): WaypointFolderTaskKind {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  const node = isRecord(runner.node) ? runner.node : {}
  if (isWaypointFolderTaskKind(node.type)) return node.type
  const recipe = isRecord(runner.recipe) ? runner.recipe : {}
  if (typeof recipe.slug === 'string' && recipe.slug.trim()) return 'recipe'
  const discussion = isRecord(runner.discussion) ? runner.discussion : {}
  if (discussion.enabled === true) return 'discussion'
  const gate = isRecord(runner.gate) ? runner.gate : {}
  if (gate.required === true) return 'gate'
  return 'checkpoint'
}

function isWaypointFolderTaskKind(value: unknown): value is WaypointFolderTaskKind {
  return (
    value === 'recipe' ||
    value === 'discussion' ||
    value === 'gate' ||
    value === 'checkpoint' ||
    value === 'wait' ||
    value === 'delay' ||
    value === 'timer' ||
    value === 'dependency' ||
    value === 'system'
  )
}

function taskMetadataFor(taskNumber: number, metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const waypoint = isRecord(metadata?.runner) ? metadata.runner : {}
  const discussion = isRecord(waypoint.discussion) ? waypoint.discussion : {}
  if (discussion.enabled !== true) return metadata
  const agent = typeof discussion.agent === 'string' && discussion.agent.trim() ? discussion.agent.trim() : 'agent'
  return {
    ...metadata,
    runner: {
      ...waypoint,
      discussion: {
        ...discussion,
        enabled: true,
        mode: 'agent_chat',
        conversation_id: buildWaypointTaskDiscussionConversationId(taskNumber, agent),
        agent,
        status: 'active',
      },
    },
  }
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
