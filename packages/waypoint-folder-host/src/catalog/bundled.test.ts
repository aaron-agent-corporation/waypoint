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
  it('loads bundled Quests and Waypoint Recipes from the repo root', async () => {
    const catalog = await loadBundledWaypointCatalog()

    expect(catalog.quests.has('waypoint')).toBe(true)
    expect(catalog.questEntries.some((entry) => entry.slug === 'waypoint' && entry.relativePath === 'waypoint.yaml')).toBe(true)

    const waypointRecipeEntries = catalog.recipeEntries.filter((entry) => entry.slug.startsWith('waypoint-'))
    expect(waypointRecipeEntries).toHaveLength(33)
    expect(waypointRecipeEntries.some((entry) => entry.slug === 'waypoint-doc-writer')).toBe(true)
  })

  it('resolves the Recipes referenced by a bundled Quest', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const resolved = catalog.resolveQuestRecipes('waypoint')

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.quest.slug).toBe('waypoint')
    expect(resolved.recipes.map((recipe) => recipe.slug)).toContain('waypoint-doc-writer')
  })

  it('installs a selected Quest and referenced Recipes into a local project', async () => {
    const projectRoot = await makeTempProject()
    const catalog = await loadBundledWaypointCatalog()

    const result = await installQuestCatalog(projectRoot, catalog, { quest: 'waypoint' })

    expect(result.quest.slug).toBe('waypoint')
    expect(result.installedQuestPaths).toEqual(['.waypoint/quests/waypoint.yaml'])
    expect(result.installedRecipePaths).toContain('.waypoint/recipes/waypoint/doc-writer.yaml')
    expect(result.installedRecipePaths).toHaveLength(result.recipes.length)
  })
})
