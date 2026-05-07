import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from './bundled.ts'
import { installQuestCatalog } from './install.ts'

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-catalog-test-'))
}

describe('bundled Waypoint catalog', () => {
  it('loads bundled Quests and GSD Recipes from the repo root', async () => {
    const catalog = await loadBundledWaypointCatalog()

    expect(catalog.quests.has('gsd')).toBe(true)
    expect(catalog.questEntries.some((entry) => entry.slug === 'gsd' && entry.relativePath === 'gsd.yaml')).toBe(true)

    const gsdRecipeEntries = catalog.recipeEntries.filter((entry) => entry.slug.startsWith('gsd-'))
    expect(gsdRecipeEntries).toHaveLength(33)
    expect(gsdRecipeEntries.some((entry) => entry.slug === 'gsd-doc-writer')).toBe(true)
  })

  it('resolves the Recipes referenced by a bundled Quest', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const resolved = catalog.resolveQuestRecipes('gsd')

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.quest.slug).toBe('gsd')
    expect(resolved.recipes.map((recipe) => recipe.slug)).toContain('gsd-doc-writer')
  })

  it('installs a selected Quest and referenced Recipes into a local project', async () => {
    const projectRoot = await makeTempProject()
    const catalog = await loadBundledWaypointCatalog()

    const result = await installQuestCatalog(projectRoot, catalog, { quest: 'gsd' })

    expect(result.quest.slug).toBe('gsd')
    expect(result.installedQuestPaths).toEqual(['.waypoint/quests/gsd.yaml'])
    expect(result.installedRecipePaths).toContain('.waypoint/recipes/gsd/doc-writer.yaml')
    expect(result.installedRecipePaths).toHaveLength(result.recipes.length)
  })
})
