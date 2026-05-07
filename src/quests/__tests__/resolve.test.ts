import { describe, it, expect } from 'vitest'
import {
  resolveQuestRecipes,
  createQuestRegistry,
  createRecipeRegistry,
  parseQuestManifest,
  parseRecipeManifest,
  type QuestManifest,
  type RecipeManifest,
} from '../../index.js'

function quest(slug: string, recipes?: string[]): QuestManifest {
  return {
    schema_version: 1,
    slug,
    name: slug,
    workflow: `${slug}.yaml`,
    ...(recipes ? { recipes } : {}),
  }
}

function recipe(slug: string): RecipeManifest {
  return { schema_version: 1, slug, name: slug, prompt: `p-${slug}` }
}

describe('resolveQuestRecipes', () => {
  it('returns ok with resolved recipes when all references exist', () => {
    const recipes = createRecipeRegistry()
    recipes.add(recipe('doc-writer'))
    recipes.add(recipe('researcher'))

    const q = quest('waypoint', ['doc-writer', 'researcher'])
    const result = resolveQuestRecipes(q, recipes)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'researcher'])
  })

  it('returns ok with empty list when quest has no recipes', () => {
    const recipes = createRecipeRegistry()
    const q = quest('minimal')
    const result = resolveQuestRecipes(q, recipes)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved).toEqual([])
  })

  it('returns unresolved_recipe error listing all missing slugs', () => {
    const recipes = createRecipeRegistry()
    recipes.add(recipe('doc-writer'))

    const q = quest('waypoint', ['doc-writer', 'missing-a', 'missing-b'])
    const result = resolveQuestRecipes(q, recipes)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('unresolved_recipe')
    expect(result.error.unresolved).toEqual(['missing-a', 'missing-b'])
  })

  it('preserves recipe order from the quest manifest', () => {
    const recipes = createRecipeRegistry()
    recipes.add(recipe('c'))
    recipes.add(recipe('a'))
    recipes.add(recipe('b'))

    const q = quest('ordered', ['c', 'a', 'b'])
    const result = resolveQuestRecipes(q, recipes)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved.map((r) => r.slug)).toEqual(['c', 'a', 'b'])
  })
})

describe('end-to-end parse + registry + resolve', () => {
  it('loads a quest and recipes from YAML and resolves references', () => {
    const questYaml = `
schema_version: 1
slug: waypoint
name: GSD Lifecycle
workflow: gsd.workflow.yaml
recipes:
  - doc-writer
  - reviewer
`
    const doc = `
schema_version: 1
slug: doc-writer
name: Doc Writer
prompt: "write docs"
`
    const rev = `
schema_version: 1
slug: reviewer
name: Reviewer
prompt: "review work"
`
    const quests = createQuestRegistry()
    const recipes = createRecipeRegistry()

    const qp = parseQuestManifest(questYaml)
    expect(qp.ok).toBe(true)
    if (!qp.ok) throw new Error('quest parse failed')
    quests.add(qp.manifest)

    for (const text of [doc, rev]) {
      const rp = parseRecipeManifest(text)
      expect(rp.ok).toBe(true)
      if (!rp.ok) throw new Error('recipe parse failed')
      recipes.add(rp.manifest)
    }

    const loaded = quests.get('waypoint')
    expect(loaded).toBeDefined()
    if (!loaded) return

    const resolved = resolveQuestRecipes(loaded, recipes)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected success')
    expect(resolved.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'reviewer'])
  })
})
