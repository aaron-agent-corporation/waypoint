import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { clearBundledWaypointCatalogCache, loadBundledWaypointCatalog, loadRecipeEntries } from './bundled.ts'
import { installQuestCatalog } from './install.ts'

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-catalog-test-'))
}

// The bundled catalog cache is module-level state; clear it after each test so the
// memoized instance can't leak across tests within this file (waypoint-7ok N1).
afterEach(() => {
  clearBundledWaypointCatalogCache()
})

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

  // P2-1: the curated, immutable bundle must fail loud on a malformed manifest
  // (a packaging defect), unlike the tolerant collect-and-warn workspace load.
  it('strict loading throws on a malformed manifest; tolerant loading collects it', async () => {
    const dir = await makeTempProject()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'good.yaml'), 'schema_version: 1\nslug: good\nname: Good\nprompt: Do it.\n', 'utf8')
    await writeFile(join(dir, 'bad.yaml'), 'schema_version: 2\nslug: bad\nname: Bad\n', 'utf8')

    await expect(loadRecipeEntries(dir, { strict: true })).rejects.toThrow(/invalid Recipe manifest: bad\.yaml/)

    const tolerant = await loadRecipeEntries(dir)
    expect(tolerant.entries.map((e) => e.slug)).toEqual(['good'])
    expect(tolerant.errors).toHaveLength(1)
  })

  // Memoization: the immutable bundle is loaded once per process (the autopilot
  // route runner resolves it once per recipe). The cache is reset for the next test.
  it('memoizes the default bundled catalog and re-loads after a cache clear', async () => {
    clearBundledWaypointCatalogCache()
    const a = await loadBundledWaypointCatalog()
    const b = await loadBundledWaypointCatalog()
    expect(a).toBe(b) // same object — no re-walk

    clearBundledWaypointCatalogCache()
    const c = await loadBundledWaypointCatalog()
    expect(c).not.toBe(a) // fresh load after clear
    expect(c.quests.has('waypoint')).toBe(true)
  })

  // H1 is scoped to the shared bundled singleton: it is frozen so a consumer that
  // mutates it in place fails loudly. (Fresh workspace overlays are left mutable.)
  it('freezes the shared bundled catalog container and its lists', async () => {
    const catalog = await loadBundledWaypointCatalog()
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.questEntries)).toBe(true)
    expect(Object.isFrozen(catalog.recipeEntries)).toBe(true)
    expect(() => (catalog.questEntries as unknown as unknown[]).push({})).toThrow()
  })
})
