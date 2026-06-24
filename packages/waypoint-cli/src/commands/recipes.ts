import {
  findWaypointProjectRoot,
  formatCatalogEntryWarning,
  loadBundledWaypointCatalog,
  loadWorkspaceWaypointCatalog,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runRecipesCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readStringOption(args, '--quest')
  const projectRoot = await findWaypointProjectRoot(io.cwd ?? process.cwd())
  const catalog = projectRoot ? await loadWorkspaceWaypointCatalog(projectRoot) : await loadBundledWaypointCatalog()

  if (quest) {
    const resolved = catalog.resolveQuestRecipes(quest)
    if (!resolved.ok) {
      io.stderr(resolved.message)
      return 1
    }

    io.stdout(`Recipes for Quest: ${quest}`)
    for (const recipe of resolved.recipes) {
      io.stdout(`- ${recipe.slug}: ${recipe.name}`)
    }
    return 0
  }

  // Skip-and-warn: a malformed authored manifest is reported, not fatal to the list.
  for (const error of catalog.recipeErrors) io.stderr(formatCatalogEntryWarning(error))
  io.stdout('Waypoint Recipes')
  for (const recipe of catalog.recipes.list()) {
    io.stdout(`- ${recipe.slug}: ${recipe.name}`)
  }
  return 0
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
