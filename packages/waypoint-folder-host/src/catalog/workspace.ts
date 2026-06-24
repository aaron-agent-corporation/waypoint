import { join } from 'node:path'

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
  // break resolution/discovery of every other entry. Reconcile each errored file
  // against its bundled twin (workspace-wins) before merging/listing.
  const questRecon = reconcileWorkspaceErrors(bundled.questEntries, workspaceQuests.errors)
  const recipeRecon = reconcileWorkspaceErrors(bundled.recipeEntries, workspaceRecipes.errors)

  const questErrors = [...bundled.questErrors, ...questRecon.errors]
  const recipeErrors = [...bundled.recipeErrors, ...recipeRecon.errors]

  // A workspace override that errored is the intended winner (workspace-wins).
  // Tombstone its bundled twin so resolve/run fails loud on the parse error instead
  // of silently falling back to — and running — the bundled implementation.
  const questEntries = mergeEntries(bundled.questEntries, workspaceQuests.entries, questRecon.tombstones)
  const recipeEntries = mergeEntries(bundled.recipeEntries, workspaceRecipes.entries, recipeRecon.tombstones)

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
 * Decide which bundled slugs a set of errored workspace files must tombstone, and
 * repair the errors so the listing/resolve can name the affected slot.
 *
 * The identity rule branches on whether the malformed file declared a slug:
 *  - slug present  → tombstone exactly that declared slug. NEVER union the basename
 *    — a `declared-slug != filename` file must not drop an unrelated bundled entry.
 *  - slug absent   → too malformed to declare a slot, so identify the shadowed
 *    bundled entry by EXACT relativePath (same path = same slot) rather than
 *    guessing a slug from the basename (which mis-matches when a bundled slug ≠ its
 *    filename). Repair the error's slug from the twin so resolve fails loud with a
 *    parse-specific message; if no twin exists, leave it (a brand-new broken file).
 */
function reconcileWorkspaceErrors<TManifest>(
  bundled: readonly WaypointCatalogEntry<TManifest>[],
  errors: readonly CatalogEntryError[],
): { tombstones: ReadonlySet<string>; errors: CatalogEntryError[] } {
  const tombstones = new Set<string>()
  const reconciled: CatalogEntryError[] = []
  for (const error of errors) {
    if (error.slug) {
      tombstones.add(error.slug)
      reconciled.push(error)
      continue
    }
    const twin = bundled.find((entry) => entry.relativePath === error.relativePath)
    if (twin) {
      tombstones.add(twin.slug)
      reconciled.push({ ...error, slug: twin.slug })
    } else {
      reconciled.push(error)
    }
  }
  return { tombstones, errors: reconciled }
}

/**
 * Merge entries by slug — workspace (second arg) wins — then slug-sort for
 * determinism. A bundled entry is dropped when its slug was tombstoned by an
 * errored workspace override, so a failed override cannot fall back to its twin.
 */
function mergeEntries<TManifest>(
  bundled: readonly WaypointCatalogEntry<TManifest>[],
  workspace: readonly WaypointCatalogEntry<TManifest>[],
  tombstones: ReadonlySet<string>,
): WaypointCatalogEntry<TManifest>[] {
  const bySlug = new Map<string, WaypointCatalogEntry<TManifest>>()
  for (const entry of bundled) {
    if (tombstones.has(entry.slug)) continue
    bySlug.set(entry.slug, entry)
  }
  for (const entry of workspace) bySlug.set(entry.slug, entry)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
