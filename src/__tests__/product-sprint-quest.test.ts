import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { loadQuestsFromDirectory, loadRecipesFromDirectory, resolveQuestRecipes } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

const REQUIRED_PRODUCT_SPRINT_RECIPES = [
  'product-sprint-office-hours',
  'product-sprint-ceo-review',
  'product-sprint-eng-review',
  'product-sprint-design-review',
  'product-sprint-devex-review',
  'product-sprint-autoplan',
  'product-sprint-review',
  'product-sprint-qa-only',
  'product-sprint-ship',
  'product-sprint-retro',
]

const EXPECTED_PHASES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect']

describe('Product Sprint Quest', () => {
  it('loads as a primary starter Quest with source-backed gstack-derived Recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const quest = quests.registry.get('product-sprint')
    expect(quest).toBeDefined()
    if (!quest) throw new Error('missing product-sprint Quest')

    expect(quest.name).toBe('Product Sprint')
    expect(quest.metadata?.waypoint).toMatchObject({
      quest_family: 'primary_starter',
      public_name: 'Product Sprint',
      selection_summary: 'product ideation, review, QA, and ship cycles',
      source_family: 'gstack',
    })
    expect(quest.metadata?.source).toMatchObject({
      project: 'gstack',
      package: 'gstack',
      version: '1.40.0.0',
      license: 'MIT',
    })

    expect(quest.recipes).toEqual(REQUIRED_PRODUCT_SPRINT_RECIPES)
    const phases = (quest.scaffolds?.workstreams ?? []).flatMap((workstream) =>
      (workstream.milestones ?? []).flatMap((milestone) =>
        (milestone.phases ?? []).map((phase) => phase.phase_slug),
      ),
    )
    expect(phases).toEqual(EXPECTED_PHASES)

    const resolved = resolveQuestRecipes(quest, recipes.registry)
    expect(resolved.ok, 'all Product Sprint recipe references should resolve').toBe(true)
    if (!resolved.ok) return

    for (const slug of REQUIRED_PRODUCT_SPRINT_RECIPES) {
      const recipe = resolved.resolved.find((candidate) => candidate.slug === slug)
      expect(recipe, `${slug} should resolve`).toBeDefined()
      expect(recipe?.prompt.length, `${slug} prompt should be present`).toBeGreaterThan(100)
      expect(recipe?.metadata?.source).toMatchObject({
        project: 'gstack',
        package: 'gstack',
        version: '1.40.0.0',
        license: 'MIT',
      })
      expect(recipe?.metadata?.waypoint).toMatchObject({
        source_port_scope: 'methodology_recipe',
      })
    }

    for (const gatedSlug of ['product-sprint-qa-only', 'product-sprint-ship']) {
      const recipe = resolved.resolved.find((candidate) => candidate.slug === gatedSlug)
      expect(recipe?.metadata?.waypoint).toMatchObject({
        external_side_effects: 'gated',
      })
    }
  })
})
