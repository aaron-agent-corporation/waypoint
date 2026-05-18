import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { loadQuestsFromDirectory, loadRecipesFromDirectory, resolveQuestRecipes } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

const REQUIRED_AGILE_DELIVERY_RECIPES = [
  'agile-delivery-prd',
  'agile-delivery-architecture',
  'agile-delivery-epics-stories',
  'agile-delivery-readiness',
  'agile-delivery-sprint-planning',
  'agile-delivery-create-story',
  'agile-delivery-dev-story',
]

describe('Agile Delivery Quest', () => {
  it('loads as a primary starter Quest with source-backed BMAD-derived Recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const quest = quests.registry.get('agile-delivery')
    expect(quest).toBeDefined()
    if (!quest) throw new Error('missing agile-delivery Quest')

    expect(quest.name).toBe('Agile Delivery')
    expect(quest.metadata?.waypoint).toMatchObject({
      quest_family: 'primary_starter',
      public_name: 'Agile Delivery',
      source_family: 'bmad-method',
    })
    expect(quest.metadata?.source).toMatchObject({
      project: 'bmad-method',
      package: 'bmad-method',
      version: '6.7.0',
      license: 'MIT',
    })

    expect(quest.recipes).toEqual(expect.arrayContaining(REQUIRED_AGILE_DELIVERY_RECIPES))
    const resolved = resolveQuestRecipes(quest, recipes.registry)
    expect(resolved.ok, 'all Agile Delivery recipe references should resolve').toBe(true)
    if (!resolved.ok) return

    for (const slug of REQUIRED_AGILE_DELIVERY_RECIPES) {
      const recipe = resolved.resolved.find((candidate) => candidate.slug === slug)
      expect(recipe, `${slug} should resolve`).toBeDefined()
      expect(recipe?.metadata?.source).toMatchObject({
        project: 'bmad-method',
        package: 'bmad-method',
        version: '6.7.0',
        license: 'MIT',
      })
      expect(recipe?.metadata?.source_port).toMatchObject({
        external_side_effects: 'forbidden',
      })
    }
  })
})
