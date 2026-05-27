import type { WaypointBeadsExternalSideEffects, WaypointBeadsRecipeRuntimeSpec } from './compiler.ts'
import type { WaypointBeadsRunReconstruction, WaypointBeadsRunTask } from './reconstruct.ts'

export type WaypointBeadsRuntimeExternalSideEffects = 'none' | 'gated' | 'allowed'
export type WaypointBeadsRecipeExecutionAction = 'run' | 'block' | 'skip'
export type WaypointBeadsRecipeExecutionBlockReason =
  | 'not_recipe'
  | 'task_not_ready'
  | 'missing_recipe_slug'
  | 'missing_required_tools'
  | 'external_side_effects_forbidden'
  | 'external_side_effects_require_approval'
  | 'external_side_effects_unspecified'

export interface WaypointBeadsRecipeRuntimePolicy {
  readonly external_side_effects: WaypointBeadsRuntimeExternalSideEffects
  readonly approved_gated_side_effects?: boolean
  readonly supported_tools?: readonly string[]
}

export interface WaypointBeadsRecipeExecutionPlan {
  readonly action: WaypointBeadsRecipeExecutionAction
  readonly task: WaypointBeadsRunTask
  readonly recipe_slug?: string
  readonly policy: {
    readonly recipe_external_side_effects: WaypointBeadsExternalSideEffects
    readonly runtime_external_side_effects: WaypointBeadsRuntimeExternalSideEffects
  }
  readonly runtime?: WaypointBeadsRecipeRuntimeSpec
  readonly tools: readonly string[]
  readonly missing_tools: readonly string[]
  readonly block_reason?: WaypointBeadsRecipeExecutionBlockReason
}

export function planWaypointBeadsRecipeExecution(
  task: WaypointBeadsRunTask,
  runtimePolicy: WaypointBeadsRecipeRuntimePolicy,
): WaypointBeadsRecipeExecutionPlan {
  const recipeSlug = task.metadata.waypoint.recipe_slug
  const runtime = task.metadata.waypoint.recipe
  const tools = runtime?.tools ?? []
  const missingTools = missingRequiredTools(tools, runtimePolicy.supported_tools)
  const policy = {
    recipe_external_side_effects: task.metadata.waypoint.policy.external_side_effects,
    runtime_external_side_effects: runtimePolicy.external_side_effects,
  }

  if (task.kind !== 'recipe') {
    return blockedPlan('skip', task, policy, runtime, tools, missingTools, 'not_recipe')
  }
  if (task.status !== 'open' || task.blockers.length > 0) {
    return blockedPlan('block', task, policy, runtime, tools, missingTools, 'task_not_ready')
  }
  if (!recipeSlug) {
    return blockedPlan('block', task, policy, runtime, tools, missingTools, 'missing_recipe_slug')
  }
  if (missingTools.length > 0) {
    return blockedPlan('block', task, policy, runtime, tools, missingTools, 'missing_required_tools', recipeSlug)
  }

  const sideEffectBlockReason = sideEffectBlockReasonFor(task.metadata.waypoint.policy.external_side_effects, runtimePolicy)
  if (sideEffectBlockReason) {
    return blockedPlan('block', task, policy, runtime, tools, missingTools, sideEffectBlockReason, recipeSlug)
  }

  return {
    action: 'run',
    task,
    recipe_slug: recipeSlug,
    policy,
    runtime,
    tools,
    missing_tools: [],
  }
}

export function listRunnableWaypointBeadsRecipeExecutions(
  reconstruction: WaypointBeadsRunReconstruction,
  runtimePolicy: WaypointBeadsRecipeRuntimePolicy,
): readonly WaypointBeadsRecipeExecutionPlan[] {
  return reconstruction.tasks
    .map((task) => planWaypointBeadsRecipeExecution(task, runtimePolicy))
    .filter((plan) => plan.action === 'run')
}

function blockedPlan(
  action: WaypointBeadsRecipeExecutionAction,
  task: WaypointBeadsRunTask,
  policy: WaypointBeadsRecipeExecutionPlan['policy'],
  runtime: WaypointBeadsRecipeRuntimeSpec | undefined,
  tools: readonly string[],
  missingTools: readonly string[],
  blockReason: WaypointBeadsRecipeExecutionBlockReason,
  recipeSlug?: string,
): WaypointBeadsRecipeExecutionPlan {
  return {
    action,
    task,
    ...(recipeSlug ? { recipe_slug: recipeSlug } : {}),
    policy,
    runtime,
    tools,
    missing_tools: missingTools,
    block_reason: blockReason,
  }
}

function sideEffectBlockReasonFor(
  recipePolicy: WaypointBeadsExternalSideEffects,
  runtimePolicy: WaypointBeadsRecipeRuntimePolicy,
): WaypointBeadsRecipeExecutionBlockReason | undefined {
  if (runtimePolicy.external_side_effects === 'none') return undefined
  if (recipePolicy === 'forbidden') return 'external_side_effects_forbidden'
  if (recipePolicy === 'gated' && !runtimePolicy.approved_gated_side_effects) {
    return 'external_side_effects_require_approval'
  }
  if (recipePolicy === 'unspecified') return 'external_side_effects_unspecified'
  return undefined
}

function missingRequiredTools(required: readonly string[], supported: readonly string[] | undefined): readonly string[] {
  if (!supported) return []
  const supportedSet = new Set(supported)
  return required.filter((tool) => !supportedSet.has(tool))
}
