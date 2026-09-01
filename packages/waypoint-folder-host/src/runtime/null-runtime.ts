export interface NullRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: string
  readonly prompt?: string
  readonly projectRoot: string
  readonly signal?: AbortSignal
}

export interface NullRecipeRuntimeOutput {
  readonly status: 'simulated'
  readonly runtime: 'null'
  readonly recipe: string
  readonly task_id: string
  readonly route_id: string
}

export class NullRecipeRuntime {
  async runRecipe(input: NullRecipeRuntimeInput): Promise<NullRecipeRuntimeOutput> {
    return {
      status: 'simulated',
      runtime: 'null',
      recipe: input.recipe,
      task_id: input.taskId,
      route_id: input.routeId,
    }
  }
}

/**
 * Q1 (docs/designs/q-quest-proving.md): the runtime a project gets when
 * `runtime.recipe` is UNSET — as opposed to the explicit `'null'` opt-in.
 * Subclasses NullRecipeRuntime so manifest-skip logic is unchanged, but
 * running a recipe through it is an error: an unconfigured project must
 * never have work silently marked simulated. The bridge checks for this
 * class BEFORE claiming, so recipe dispatches stay pending (visible, loud)
 * instead of becoming false failed attempts or a crash loop.
 */
export class UnconfiguredRecipeRuntime extends NullRecipeRuntime {
  override async runRecipe(input: NullRecipeRuntimeInput): Promise<NullRecipeRuntimeOutput> {
    throw new Error(
      `Recipe '${input.recipe}' cannot run: runtime.recipe is not configured in .waypoint/config.yaml. ` +
        "Configure `runtime.recipe: worker` with `runtime.worker.command`, or opt into simulation explicitly with `runtime.recipe: 'null'`.",
    )
  }
}
