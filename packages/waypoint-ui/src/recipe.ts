import type { WaypointFolderTask } from './engine/types'

/** The five recipe-manifest fields the UI renders (subset of the wire manifest). */
export interface Recipe {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly tools?: readonly string[]
}

/**
 * The single place the backend-specific recipe-slug path is encoded. Folder-host
 * writes the slug nested at metadata.waypoint.recipe.slug; the Beads backend
 * writes it flat at metadata.waypoint.recipe_slug. Both are read so every
 * consumer (selectTask, the graph badge, the subtitle) agrees on recipe-ness.
 * Returns null for a missing/empty slug or non-object metadata.
 */
export function recipeSlugOf(task: Pick<WaypointFolderTask, 'metadata'>): string | null {
  const meta = task.metadata
  if (typeof meta !== 'object' || meta === null) return null
  const waypoint = (meta as Record<string, unknown>).waypoint
  if (typeof waypoint !== 'object' || waypoint === null) return null
  const wp = waypoint as Record<string, unknown>
  const nested = wp.recipe
  const nestedSlug = typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>).slug : undefined
  const flatSlug = wp.recipe_slug
  const slug = typeof nestedSlug === 'string' ? nestedSlug : typeof flatSlug === 'string' ? flatSlug : undefined
  return slug && slug.length > 0 ? slug : null
}

export interface RecipeCaches {
  readonly recipesByQuest: Record<string, Recipe[]>
  readonly recipesAll: Recipe[] | null
}

/** Resolve a slug to a manifest: active quest cache first, then global. */
export function resolveRecipe(slug: string, quest: string | undefined, caches: RecipeCaches): Recipe | undefined {
  const fromQuest = quest ? caches.recipesByQuest[quest]?.find((r) => r.slug === slug) : undefined
  if (fromQuest) return fromQuest
  return caches.recipesAll?.find((r) => r.slug === slug) ?? undefined
}
