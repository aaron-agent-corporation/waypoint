export interface RecipeRunRequest {
  recipe: string
  input?: Record<string, unknown>
}

export interface RecipeRunHandle {
  runId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

export interface IRecipeRuntime {
  startRecipe(request: RecipeRunRequest): Promise<RecipeRunHandle>
  getRun(runId: string): Promise<RecipeRunHandle | null>
  cancelRun(runId: string): Promise<void>
}
