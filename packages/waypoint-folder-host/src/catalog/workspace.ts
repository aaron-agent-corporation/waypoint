import { join } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'
import {
  buildWaypointCatalog,
  isDirectory,
  loadBundledWaypointCatalog,
  loadQuestEntries,
  loadRecipeEntries,
  type BundledWaypointCatalog,
  type CatalogQuestManifest,
  type CatalogRecipeManifest,
  type WaypointCatalogEntry,
} from './bundled.ts'

/** Overlay bundled + workspace catalogs; on a slug collision the workspace entry wins. */
export async function loadWorkspaceWaypointCatalog(projectRoot: string): Promise<BundledWaypointCatalog> {
  const bundled = await loadBundledWaypointCatalog()
  const waypointDir = getWaypointProjectPaths(projectRoot).waypointDir
  const questsDir = join(waypointDir, 'quests')
  const recipesDir = join(waypointDir, 'recipes')

  const workspaceQuestEntries = (await isDirectory(questsDir)) ? await loadQuestEntries(questsDir) : []
  const workspaceRecipeEntries = (await isDirectory(recipesDir)) ? await loadRecipeEntries(recipesDir) : []

  const questEntries = mergeEntries(bundled.questEntries, workspaceQuestEntries)
  const recipeEntries = mergeEntries(bundled.recipeEntries, workspaceRecipeEntries)

  // root/questsDir/recipesDir reflect the workspace overlay's home.
  return buildWaypointCatalog({ root: waypointDir, questsDir, recipesDir, questEntries, recipeEntries })
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
