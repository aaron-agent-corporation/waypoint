import type { QuestManifest } from './manifest.js'
import type { RecipeRegistry } from '../recipes/registry.js'
import type { RecipeManifest } from '../recipes/manifest.js'
import type { HandoffManifestRegistry } from '../handoffs/registry.js'
import type { HandoffManifest } from '../handoffs/manifest.js'

export type ResolveQuestRecipesResult =
  | { readonly ok: true; readonly resolved: readonly RecipeManifest[] }
  | { readonly ok: false; readonly error: ResolveQuestRecipesError }

export type ResolveQuestRecipesError = {
  readonly code: 'unresolved_recipe'
  readonly message: string
  readonly unresolved: readonly string[]
}

/**
 * Resolve a Quest's recipe references against a RecipeRegistry.
 *
 * Returns ok with the resolved RecipeManifest[] in the original order declared
 * by the Quest. If ANY referenced slug is missing, returns a single error that
 * lists ALL missing slugs (collect-all semantics, not fail-fast) so operators
 * see every problem at once.
 *
 * A Quest with no recipes resolves to an empty list successfully.
 */
export function resolveQuestRecipes(quest: QuestManifest, recipes: RecipeRegistry): ResolveQuestRecipesResult {
  const refs = quest.recipes ?? []
  if (refs.length === 0) {
    return { ok: true, resolved: [] }
  }

  const resolved: RecipeManifest[] = []
  const unresolved: string[] = []

  for (const slug of refs) {
    const found = recipes.get(slug)
    if (found) {
      resolved.push(found)
    } else {
      unresolved.push(slug)
    }
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      error: {
        code: 'unresolved_recipe',
        message: `unresolved recipe slug(s): ${unresolved.join(', ')}`,
        unresolved,
      },
    }
  }

  return { ok: true, resolved }
}

export type ResolveQuestHandoffManifestsResult =
  | { readonly ok: true; readonly resolved: readonly HandoffManifest[] }
  | { readonly ok: false; readonly error: ResolveQuestHandoffManifestsError }

export type ResolveQuestHandoffManifestsError = {
  readonly code: 'unresolved_handoff_manifest'
  readonly message: string
  readonly unresolved: readonly string[]
}

/**
 * Resolve a Quest's handoff manifest references against a HandoffManifestRegistry.
 *
 * Returns ok with the resolved HandoffManifest[] in the original order declared
 * by the Quest. If ANY referenced slug is missing, returns a single error that
 * lists ALL missing slugs so operators see every problem at once.
 *
 * A Quest with no handoff_manifests resolves to an empty list successfully.
 */
export function resolveQuestHandoffManifests(
  quest: QuestManifest,
  handoffManifests: HandoffManifestRegistry,
): ResolveQuestHandoffManifestsResult {
  const refs = quest.handoff_manifests ?? []
  if (refs.length === 0) {
    return { ok: true, resolved: [] }
  }

  const resolved: HandoffManifest[] = []
  const unresolved: string[] = []

  for (const slug of refs) {
    const found = handoffManifests.get(slug)
    if (found) {
      resolved.push(found)
    } else {
      unresolved.push(slug)
    }
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      error: {
        code: 'unresolved_handoff_manifest',
        message: `unresolved handoff manifest slug(s): ${unresolved.join(', ')}`,
        unresolved,
      },
    }
  }

  return { ok: true, resolved }
}
