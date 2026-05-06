import { isRecipeManifest, type RecipeManifest } from './manifest.js'

export type RecipeRegistryAddErrorCode = 'slug_collision' | 'invalid_manifest'

export type RecipeRegistryAddResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: RecipeRegistryAddErrorCode; readonly message: string } }

export type RecipeRegistry = {
  add(manifest: RecipeManifest): RecipeRegistryAddResult
  get(slug: string): RecipeManifest | undefined
  has(slug: string): boolean
  list(): readonly RecipeManifest[]
  readonly size: number
}

/**
 * Create a fresh RecipeRegistry. Same factory pattern as QuestRegistry.
 * Validation happens on add() only; lookup assumes previously-added items are valid.
 */
export function createRecipeRegistry(): RecipeRegistry {
  const items = new Map<string, RecipeManifest>()

  return {
    add(manifest) {
      if (!isRecipeManifest(manifest)) {
        return { ok: false, error: { code: 'invalid_manifest', message: 'not a valid RecipeManifest' } }
      }
      if (items.has(manifest.slug)) {
        return {
          ok: false,
          error: { code: 'slug_collision', message: `slug already registered: ${manifest.slug}` },
        }
      }
      items.set(manifest.slug, manifest)
      return { ok: true }
    },
    get(slug) {
      return items.get(slug)
    },
    has(slug) {
      return items.has(slug)
    },
    list() {
      return Array.from(items.values()).sort((a, b) => a.slug.localeCompare(b.slug))
    },
    get size() {
      return items.size
    },
  }
}
