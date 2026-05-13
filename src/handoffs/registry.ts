import { isHandoffManifest, type HandoffManifest } from './manifest.js'

export type HandoffManifestRegistryAddErrorCode = 'slug_collision' | 'invalid_manifest'

export type HandoffManifestRegistryAddResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: HandoffManifestRegistryAddErrorCode; readonly message: string } }

export type HandoffManifestRegistry = {
  add(manifest: HandoffManifest): HandoffManifestRegistryAddResult
  get(slug: string): HandoffManifest | undefined
  has(slug: string): boolean
  list(): readonly HandoffManifest[]
  readonly size: number
}

export function createHandoffManifestRegistry(): HandoffManifestRegistry {
  const items = new Map<string, HandoffManifest>()

  return {
    add(manifest) {
      if (!isHandoffManifest(manifest)) {
        return { ok: false, error: { code: 'invalid_manifest', message: 'not a valid HandoffManifest' } }
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
