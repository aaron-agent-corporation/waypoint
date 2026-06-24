import { basename, join } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'
import {
  buildWaypointCatalog,
  isDirectory,
  loadBundledWaypointCatalog,
  loadQuestEntries,
  loadRecipeEntries,
  type BundledWaypointCatalog,
  type CatalogEntryError,
  type WaypointCatalogEntry,
} from './bundled.ts'

/** Overlay bundled + workspace catalogs; on a slug collision the workspace entry wins. */
export async function loadWorkspaceWaypointCatalog(projectRoot: string): Promise<BundledWaypointCatalog> {
  const bundled = await loadBundledWaypointCatalog()
  const waypointDir = getWaypointProjectPaths(projectRoot).waypointDir
  const questsDir = join(waypointDir, 'quests')
  const recipesDir = join(waypointDir, 'recipes')

  const workspaceQuests = (await isDirectory(questsDir)) ? await loadQuestEntries(questsDir) : { entries: [], errors: [] }
  const workspaceRecipes = (await isDirectory(recipesDir))
    ? await loadRecipeEntries(recipesDir)
    : { entries: [], errors: [] }

  // A malformed authored manifest is collected (not thrown) so it can no longer
  // break resolution/discovery of every other entry. Errors flow to the catalog
  // for listing surfaces to warn on; the start path stays fail-loud per-quest.
  const questErrors = [...bundled.questErrors, ...workspaceQuests.errors]
  const recipeErrors = [...bundled.recipeErrors, ...workspaceRecipes.errors]

  // B0: a workspace override that errored is the intended winner (workspace-wins).
  // Tombstone its bundled twin so resolve/run fails loud on the parse error instead
  // of silently falling back to — and running — the bundled implementation.
  const questEntries = mergeEntries(bundled.questEntries, workspaceQuests.entries, erroredSlugs(workspaceQuests.errors))
  const recipeEntries = mergeEntries(bundled.recipeEntries, workspaceRecipes.entries, erroredSlugs(workspaceRecipes.errors))

  // root/questsDir/recipesDir reflect the workspace overlay's home.
  return buildWaypointCatalog({
    root: waypointDir,
    questsDir,
    recipesDir,
    questEntries,
    recipeEntries,
    questErrors,
    recipeErrors,
  })
}

/**
 * The identities of the workspace files that failed to parse — keyed by the
 * leniently-read slug AND the file basename. This MUST match findEntryError's
 * keying (slug → basename): a file too malformed to yield a slug still tombstones
 * its bundled twin by filename, so the slug-less case fails loud on resolve
 * instead of silently running the bundled implementation.
 */
function erroredSlugs(errors: readonly CatalogEntryError[]): ReadonlySet<string> {
  const slugs = new Set<string>()
  for (const error of errors) {
    if (error.slug) slugs.add(error.slug)
    slugs.add(basename(error.relativePath).replace(/\.ya?ml$/, ''))
  }
  return slugs
}

/**
 * Merge entries by slug — workspace (second arg) wins — then slug-sort for
 * determinism. A bundled entry is dropped when its slug names a workspace file
 * that errored, so a failed override cannot fall back to the bundled twin.
 */
function mergeEntries<TManifest>(
  bundled: readonly WaypointCatalogEntry<TManifest>[],
  workspace: readonly WaypointCatalogEntry<TManifest>[],
  erroredWorkspaceSlugs: ReadonlySet<string>,
): WaypointCatalogEntry<TManifest>[] {
  const bySlug = new Map<string, WaypointCatalogEntry<TManifest>>()
  for (const entry of bundled) {
    if (erroredWorkspaceSlugs.has(entry.slug)) continue
    bySlug.set(entry.slug, entry)
  }
  for (const entry of workspace) bySlug.set(entry.slug, entry)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
