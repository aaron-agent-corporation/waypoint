export interface NullRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: string
  readonly prompt?: string
  readonly projectRoot: string
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
