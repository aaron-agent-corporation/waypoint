import { access, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'
import type { BundledWaypointCatalog } from './bundled.ts'

export interface InstallQuestCatalogOptions {
  readonly quest: string
  readonly preserveExistingQuest?: boolean
}

export interface InstallQuestCatalogResult {
  readonly quest: { readonly slug: string }
  readonly recipes: readonly { readonly slug: string }[]
  readonly installedQuestPaths: readonly string[]
  readonly installedRecipePaths: readonly string[]
}

export async function installQuestCatalog(
  projectRoot: string,
  catalog: BundledWaypointCatalog,
  options: InstallQuestCatalogOptions,
): Promise<InstallQuestCatalogResult> {
  const resolved = catalog.resolveQuestRecipes(options.quest)
  if (!resolved.ok) {
    throw new Error(resolved.message)
  }

  const paths = getWaypointProjectPaths(projectRoot)
  const questTarget = join(paths.waypointDir, 'quests', resolved.questEntry.relativePath)
  const questExists = await access(questTarget).then(() => true).catch(() => false)
  const preserveQuest = options.preserveExistingQuest === true && questExists
  if (!preserveQuest) {
    await copyCatalogFile(resolved.questEntry.path, questTarget)
  }

  // Recipes are workspace-wins: an already-present recipe file is preserved (it may
  // carry operator edits that are not in the bundled catalog and not re-derivable),
  // so installation never clobbers it. The first install of a quest populates its
  // recipes; subsequent Starts leave existing recipe files untouched. A recipe is
  // (re)written only when it is missing at the target.
  const installedRecipePaths: string[] = []
  for (const entry of resolved.recipeEntries) {
    const target = join(paths.waypointDir, 'recipes', entry.relativePath)
    const recipeExists = await access(target).then(() => true).catch(() => false)
    if (recipeExists) continue
    await copyCatalogFile(entry.path, target)
    installedRecipePaths.push(toProjectRelative(projectRoot, target))
  }

  return {
    quest: { slug: resolved.quest.slug },
    recipes: resolved.recipes.map((recipe) => ({ slug: recipe.slug })),
    installedQuestPaths: [toProjectRelative(projectRoot, questTarget)],
    installedRecipePaths: installedRecipePaths.sort(),
  }
}

async function copyCatalogFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

function toProjectRelative(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}
