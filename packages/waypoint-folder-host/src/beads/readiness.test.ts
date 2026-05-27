import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog, type BundledWaypointCatalog } from '../catalog/bundled.ts'
import { checkWaypointCatalogBeadsReadiness } from './readiness.ts'

describe('Waypoint Beads catalog readiness validator', () => {
  it('passes the bundled catalog when Beads runtime metadata is complete', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const report = checkWaypointCatalogBeadsReadiness(catalog)

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.summary.total).toBe(0)
    expect(Object.values(report.summary.by_code).every((count) => count === 0)).toBe(true)
  })

  it('identifies Quest plan and Recipe sources precisely enough for catalog migration work', () => {
    const catalog = malformedCatalogFixture()
    const report = checkWaypointCatalogBeadsReadiness(catalog)

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'missing_plan_node_type',
        quest_slug: 'broken-quest',
        plan_ref: 'broken-run',
        source_path: 'quests/broken-quest.yaml',
      }),
    )
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'recipe_missing_side_effect_policy',
        recipe_slug: 'broken-recipe',
        source_path: 'recipes/broken-recipe.yaml',
      }),
    )
  })
})

function malformedCatalogFixture(): BundledWaypointCatalog {
  const quest = {
    schema_version: 1 as const,
    slug: 'broken-quest',
    name: 'Broken Quest',
    workflow: 'broken.yaml',
    recipes: ['broken-recipe'],
    scaffolds: {
      workstreams: [
        {
          key: 'broken',
          milestones: [
            {
              version_label: 'v1',
              phases: [
                {
                  phase_slug: 'execute',
                  plans: [
                    {
                      plan_ref: 'broken-run',
                      title: 'Run the mapped Waypoint Recipes',
                      wave: 10,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
  const recipe = {
    schema_version: 1 as const,
    slug: 'broken-recipe',
    name: 'Broken Recipe',
  }
  return {
    root: '/fixture',
    questsDir: '/fixture/quests',
    recipesDir: '/fixture/recipes',
    quests: {
      has: (slug: string) => slug === quest.slug,
      get: (slug: string) => (slug === quest.slug ? quest : undefined),
      list: () => [quest],
      size: 1,
    },
    recipes: {
      has: (slug: string) => slug === recipe.slug,
      get: (slug: string) => (slug === recipe.slug ? recipe : undefined),
      list: () => [recipe],
      size: 1,
    },
    questEntries: [{ slug: quest.slug, manifest: quest, path: '/fixture/quests/broken-quest.yaml', relativePath: 'broken-quest.yaml' }],
    recipeEntries: [
      { slug: recipe.slug, manifest: recipe, path: '/fixture/recipes/broken-recipe.yaml', relativePath: 'broken-recipe.yaml' },
    ],
    resolveQuestRecipes: () => ({
      ok: true,
      quest,
      questEntry: { slug: quest.slug, manifest: quest, path: '/fixture/quests/broken-quest.yaml', relativePath: 'broken-quest.yaml' },
      recipes: [recipe],
      recipeEntries: [
        { slug: recipe.slug, manifest: recipe, path: '/fixture/recipes/broken-recipe.yaml', relativePath: 'broken-recipe.yaml' },
      ],
    }),
  }
}
