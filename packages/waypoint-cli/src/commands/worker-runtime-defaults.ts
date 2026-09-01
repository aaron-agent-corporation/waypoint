import type { WaypointProjectWorkerLaneConfig } from '@waypoint/folder-host'

// The settled model-class registry (docs/MODEL-ROUTING.md) scaffolded as every
// new project's default `runtime.worker.model_args` map, so a recipe's
// `runtime.model_class` resolves out of the box (rsc-m23 follow-up: tagged
// recipes were a silent no-op on fresh projects, which scaffolded no map).
// Operator-editable per project after init; recipes stay provider-neutral —
// the class names are the contract, this map is the operator's binding.

export const DEFAULT_WORKER_MODEL_ARGS = {
  high: ['--model', 'opus'],
  medium: ['--model', 'sonnet'],
  low: ['--model', 'haiku'],
} as const

export interface WorkerRuntimeConfig {
  readonly recipe: 'worker'
  readonly worker: {
    readonly command: string
    readonly args?: readonly string[]
    readonly model_args?: Readonly<Record<string, readonly string[]>>
    readonly lanes?: readonly WaypointProjectWorkerLaneConfig[]
  }
}

/** Build the standard worker runtime block from a tokenized agent command. */
export function workerRuntimeFromTokens(tokens: readonly string[]): WorkerRuntimeConfig {
  return {
    recipe: 'worker',
    worker: {
      command: tokens[0]!,
      ...(tokens.length > 1 ? { args: tokens.slice(1) } : {}),
      model_args: DEFAULT_WORKER_MODEL_ARGS,
    },
  }
}

/**
 * Attach the operator's subscription pool to a scaffolded worker runtime.
 *
 * One exhausted subscription must never stall a case when four other
 * providers sit signed in (Aaron 2026-08-15): a new case whose worker came
 * from the global default gets the global lane pool too, so lane-health can
 * fail a refused dispatch over to another account from day one. Lanes are
 * validated by the project-config parser at load, fail-closed.
 */
export function withWorkerLanes(
  runtime: WorkerRuntimeConfig,
  lanes: readonly WaypointProjectWorkerLaneConfig[],
): WorkerRuntimeConfig {
  return { ...runtime, worker: { ...runtime.worker, lanes } }
}
