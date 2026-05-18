import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { loadQuestsFromDirectory, loadRecipesFromDirectory, resolveQuestRecipes } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

const REQUIRED_AGENTIC_DELIVERY_RECIPES = [
  'agentic-delivery-using-superpowers',
  'agentic-delivery-brainstorming',
  'agentic-delivery-using-git-worktrees',
  'agentic-delivery-writing-plans',
  'agentic-delivery-subagent-driven-development',
  'agentic-delivery-executing-plans',
  'agentic-delivery-dispatching-parallel-agents',
  'agentic-delivery-test-driven-development',
  'agentic-delivery-systematic-debugging',
  'agentic-delivery-requesting-code-review',
  'agentic-delivery-receiving-code-review',
  'agentic-delivery-verification-before-completion',
  'agentic-delivery-finishing-a-development-branch',
  'agentic-delivery-writing-skills',
]

const EXPECTED_PHASES = ['discover', 'design', 'plan', 'execute', 'verify', 'ship', 'improve']

describe('Agentic Delivery Quest', () => {
  it('loads as a primary starter Quest with source-backed Superpowers-derived Recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const quest = quests.registry.get('agentic-delivery')
    expect(quest).toBeDefined()
    if (!quest) throw new Error('missing agentic-delivery Quest')

    expect(quest.name).toBe('Agentic Delivery')
    expect(quest.metadata?.waypoint).toMatchObject({
      quest_family: 'primary_starter',
      public_name: 'Agentic Delivery',
      selection_summary: 'disciplined AI-assisted software delivery from idea through verified branch finish',
      source_family: 'superpowers',
    })
    expect(quest.metadata?.source).toMatchObject({
      project: 'Superpowers',
      package: 'superpowers',
      version: '5.1.0',
      license: 'MIT',
      copyright: 'Copyright (c) 2025 Jesse Vincent',
    })

    expect(quest.recipes).toEqual(REQUIRED_AGENTIC_DELIVERY_RECIPES)
    const phases = (quest.scaffolds?.workstreams ?? []).flatMap((workstream) =>
      (workstream.milestones ?? []).flatMap((milestone) =>
        (milestone.phases ?? []).map((phase) => phase.phase_slug),
      ),
    )
    expect(phases).toEqual(EXPECTED_PHASES)

    const resolved = resolveQuestRecipes(quest, recipes.registry)
    expect(resolved.ok, 'all Agentic Delivery recipe references should resolve').toBe(true)
    if (!resolved.ok) return

    for (const slug of REQUIRED_AGENTIC_DELIVERY_RECIPES) {
      const recipe = resolved.resolved.find((candidate) => candidate.slug === slug)
      expect(recipe, `${slug} should resolve`).toBeDefined()
      expect(recipe?.prompt.length, `${slug} prompt should be present`).toBeGreaterThan(100)
      expect(recipe?.metadata?.source).toMatchObject({
        project: 'Superpowers',
        package: 'superpowers',
        version: '5.1.0',
        license: 'MIT',
        copyright: 'Copyright (c) 2025 Jesse Vincent',
      })
      expect(recipe?.metadata?.waypoint).toMatchObject({
        source_port_scope: 'methodology_recipe',
      })
    }

    for (const gatedSlug of [
      'agentic-delivery-using-git-worktrees',
      'agentic-delivery-finishing-a-development-branch',
      'agentic-delivery-requesting-code-review',
    ]) {
      const recipe = resolved.resolved.find((candidate) => candidate.slug === gatedSlug)
      expect(recipe?.metadata?.waypoint).toMatchObject({
        external_side_effects: 'gated',
      })
    }
  })
})
