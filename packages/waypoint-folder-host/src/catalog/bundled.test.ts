import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildWaypointCatalog, clearBundledWaypointCatalogCache, loadBundledWaypointCatalog, loadRecipeEntries } from './bundled.ts'
import { installQuestCatalog } from './install.ts'
import { extractQuestRoots } from '../project/config.ts'

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'runner-catalog-test-'))
}

// The bundled catalog cache is module-level state; clear it after each test so the
// memoized instance can't leak across tests within this file (runner-7ok N1).
afterEach(() => {
  clearBundledWaypointCatalogCache()
})

describe('bundled Waypoint catalog', () => {
  it('loads bundled Quests and Waypoint Recipes from the repo root', async () => {
    const catalog = await loadBundledWaypointCatalog()

    expect(catalog.quests.has('runner')).toBe(true)
    expect(catalog.questEntries.some((entry) => entry.slug === 'runner' && entry.relativePath === 'runner.yaml')).toBe(true)

    // The bundled recipe corpus is the scaffold family alone; domain recipes
    // are a host's to ship. Every recipe lives in a subdirectory of recipes/ —
    // the catalog-root probe must not depend on one sitting at the top level.
    expect(catalog.recipeEntries.length).toBeGreaterThan(0)
    expect(catalog.recipeEntries.every((entry) => entry.relativePath.includes('/'))).toBe(true)
  })

  it('a quest that binds no access roots stays empty — nothing to scaffold', async () => {
    const catalog = await loadBundledWaypointCatalog()

    expect(extractQuestRoots(catalog.quests.get('runner')?.metadata)).toEqual({})
  })

  it('resolves the Recipes referenced by a bundled Quest', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const resolved = catalog.resolveQuestRecipes('runner')

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.quest.slug).toBe('runner')
    // The scaffold is six phases, three human gates, and exactly one dispatch:
    // the discuss step's conversation.
    expect(resolved.recipes.map((recipe) => recipe.slug)).toEqual(['scaffold-discussion'])
  })

  // Item 22: both start-time validation and install pinning ride this
  // resolution, so it must return the set the route will really EXECUTE —
  // resolving only the declared `recipes:` list lets plan-dispatched recipes
  // skip validation and never install into the project.
  it('resolves plan-referenced recipes a quest forgot to declare', () => {
    const recipe = (slug: string) => ({
      slug,
      manifest: { slug, name: slug, prompt: 'Do it.' } as never,
      path: `/catalog/recipes/test/${slug}.yaml`,
      relativePath: `test/${slug}.yaml`,
    })
    const catalog = buildWaypointCatalog({
      root: '/catalog',
      questsDir: '/catalog/quests',
      recipesDir: '/catalog/recipes',
      questEntries: [
        {
          slug: 'test-quest',
          manifest: {
            slug: 'test-quest',
            recipes: ['declared-recipe'],
            scaffolds: {
              workstreams: [
                {
                  milestones: [
                    {
                      phases: [
                        {
                          phase_slug: 'run',
                          plans: [
                            {
                              plan_ref: 'run-extra',
                              title: 'Run the undeclared recipe',
                              wave: 10,
                              metadata: { runner: { recipe: { slug: 'plan-only-recipe' }, node: { type: 'recipe' } } },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          } as never,
          path: '/catalog/quests/test-quest.yaml',
          relativePath: 'test-quest.yaml',
        },
      ],
      recipeEntries: [recipe('declared-recipe'), recipe('plan-only-recipe')],
    })

    const resolved = catalog.resolveQuestRecipes('test-quest')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const slugs = resolved.recipes.map((r) => r.slug)
    expect(slugs).toContain('declared-recipe')
    expect(slugs).toContain('plan-only-recipe')
    // Deduped: a recipe both declared and plan-referenced resolves once.
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('installs a selected Quest and referenced Recipes into a local project', async () => {
    const projectRoot = await makeTempProject()
    const catalog = await loadBundledWaypointCatalog()

    const result = await installQuestCatalog(projectRoot, catalog, { quest: 'runner' })

    expect(result.quest.slug).toBe('runner')
    expect(result.installedQuestPaths).toEqual(['.waypoint/quests/runner.yaml'])
    expect(result.installedRecipePaths).toContain('.waypoint/recipes/scaffold/discussion.yaml')
    expect(result.installedRecipePaths).toHaveLength(result.recipes.length)
  })

  // workspace-wins: an operator-edited recipe must survive a second install (Start)
  it('preserves an operator-edited recipe file on re-install (workspace-wins)', async () => {
    const projectRoot = await makeTempProject()
    const catalog = await loadBundledWaypointCatalog()

    // First install: all recipes are written (no pre-existing files)
    const first = await installQuestCatalog(projectRoot, catalog, { quest: 'runner' })
    expect(first.installedRecipePaths).toHaveLength(first.recipes.length)

    // Operator overwrites one installed recipe with custom content
    const operatorContent = '# OPERATOR EDIT\n'
    const editedRelPath = first.installedRecipePaths[0]
    if (!editedRelPath) throw new Error('expected at least one installed recipe path')
    const editedAbsPath = join(projectRoot, editedRelPath)
    await writeFile(editedAbsPath, operatorContent, 'utf8')

    // Second install (re-Start): must NOT overwrite the operator-edited recipe
    const second = await installQuestCatalog(projectRoot, catalog, { quest: 'runner' })

    // All recipes pre-exist — none are newly written
    expect(second.installedRecipePaths).toHaveLength(0)

    // The operator edit must be intact
    const survived = await readFile(editedAbsPath, 'utf8')
    expect(survived).toBe(operatorContent)
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
    expect(c.quests.has('runner')).toBe(true)
  })

  // H1 is scoped to the shared bundled singleton: it is frozen so a consumer that
  // mutates it in place fails loudly. (Fresh workspace overlays are left mutable.)
  it('freezes the bundled catalog container, its registries, and all its lists', async () => {
    const catalog = await loadBundledWaypointCatalog()
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.questEntries)).toBe(true)
    expect(Object.isFrozen(catalog.recipeEntries)).toBe(true)
    expect(Object.isFrozen(catalog.questErrors)).toBe(true)
    expect(Object.isFrozen(catalog.recipeErrors)).toBe(true)
    expect(Object.isFrozen(catalog.quests)).toBe(true)
    expect(Object.isFrozen(catalog.recipes)).toBe(true)
    expect(() => (catalog.questEntries as unknown as unknown[]).push({})).toThrow()
  })
})
