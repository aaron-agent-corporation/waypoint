export interface LocalRecipePayloadInput {
  readonly recipeSlug: string
  readonly prompt: string
  readonly taskId: string
  readonly projectRoot: string
  readonly routeId: string
}

export interface LocalRecipePayload {
  readonly schema_version: 1
  readonly recipe_slug: string
  readonly prompt: string
  readonly task_id: string
  readonly project_root: string
  readonly route_id: string
}

export function buildLocalRecipePayload(input: LocalRecipePayloadInput): LocalRecipePayload {
  return {
    schema_version: 1,
    recipe_slug: input.recipeSlug,
    prompt: input.prompt,
    task_id: input.taskId,
    project_root: input.projectRoot,
    route_id: input.routeId,
  }
}
