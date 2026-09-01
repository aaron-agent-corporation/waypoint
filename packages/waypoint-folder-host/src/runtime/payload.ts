export interface LocalRecipePayloadInput {
  readonly recipeSlug: string
  readonly prompt: string
  readonly taskId: string
  readonly projectRoot: string
  readonly routeId: string
  /** Verify-then-apply scratch area: where declared output artifacts must be written (rsc-nrm). */
  readonly writeRoot?: string
  /** Declared review checks (rsc-8vw): each needs an itemized verdict in the report. */
  readonly reviewChecks?: readonly string[]
}

export interface LocalRecipePayload {
  readonly schema_version: 1
  readonly recipe_slug: string
  readonly prompt: string
  readonly task_id: string
  readonly project_root: string
  readonly route_id: string
  readonly write_root?: string
  readonly review_checks?: readonly string[]
}

export function buildLocalRecipePayload(input: LocalRecipePayloadInput): LocalRecipePayload {
  return {
    schema_version: 1,
    recipe_slug: input.recipeSlug,
    prompt: input.prompt,
    task_id: input.taskId,
    project_root: input.projectRoot,
    route_id: input.routeId,
    ...(input.writeRoot ? { write_root: input.writeRoot } : {}),
    ...(input.reviewChecks && input.reviewChecks.length > 0 ? { review_checks: input.reviewChecks } : {}),
  }
}
