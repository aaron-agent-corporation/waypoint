import { join } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'
import {
  buildWaypointCatalog,
  isDirectory,
  loadBundledWaypointCatalog,
  loadQuestEntries,
  loadRecipeEntries,
  type BundledWaypointCatalog,
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

  const questEntries = mergeEntries(bundled.questEntries, workspaceQuests.entries)
  const recipeEntries = mergeEntries(bundled.recipeEntries, workspaceRecipes.entries)
  // A malformed authored manifest is collected (not thrown) so it can no longer
  // break resolution/discovery of every other entry. Errors flow to the catalog
  // for listing surfaces to warn on; the start path stays fail-loud per-quest.
  const questErrors = [...bundled.questErrors, ...workspaceQuests.errors]
  const recipeErrors = [...bundled.recipeErrors, ...workspaceRecipes.errors]

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

/** Merge entries by slug — workspace (second arg) wins — then slug-sort for determinism. */
function mergeEntries<TManifest>(
  bundled: readonly WaypointCatalogEntry<TManifest>[],
  workspace: readonly WaypointCatalogEntry<TManifest>[],
): WaypointCatalogEntry<TManifest>[] {
  const bySlug = new Map<string, WaypointCatalogEntry<TManifest>>()
  for (const entry of bundled) bySlug.set(entry.slug, entry)
  for (const entry of workspace) bySlug.set(entry.slug, entry)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
