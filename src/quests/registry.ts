import { isQuestManifest, type QuestManifest } from './manifest.js'

export type QuestRegistryAddErrorCode = 'slug_collision' | 'invalid_manifest'

export type QuestRegistryAddResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: QuestRegistryAddErrorCode; readonly message: string } }

export type QuestRegistry = {
  add(manifest: QuestManifest): QuestRegistryAddResult
  get(slug: string): QuestManifest | undefined
  has(slug: string): boolean
  list(): readonly QuestManifest[]
  readonly size: number
}

/**
 * Create a fresh QuestRegistry. Not a class — factory that closes over a Map.
 *
 * - add() rejects invalid manifests and slug collisions with typed errors.
 * - list() returns a sorted-by-slug snapshot for stable iteration.
 * - Registry does not re-validate on lookup; add() is the single validation point.
 */
export function createQuestRegistry(): QuestRegistry {
  const items = new Map<string, QuestManifest>()

  return {
    add(manifest) {
      if (!isQuestManifest(manifest)) {
        return { ok: false, error: { code: 'invalid_manifest', message: 'not a valid QuestManifest' } }
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
