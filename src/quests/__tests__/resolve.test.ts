import { describe, it, expect } from 'vitest'
import {
  resolveQuestRecipes,
  resolveQuestHandoffManifests,
  createQuestRegistry,
  createRecipeRegistry,
  createHandoffManifestRegistry,
  parseQuestManifest,
  parseRecipeManifest,
  type QuestManifest,
  type RecipeManifest,
  type HandoffManifest,
} from '../../index.ts'

function quest(slug: string, recipes?: string[], handoffManifests?: string[]): QuestManifest {
  return {
    schema_version: 1,
    slug,
    name: slug,
    workflow: `${slug}.yaml`,
    ...(recipes ? { recipes } : {}),
    ...(handoffManifests ? { handoff_manifests: handoffManifests } : {}),
  }
}

function recipe(slug: string): RecipeManifest {
  return { schema_version: 1, slug, name: slug, prompt: `p-${slug}` }
}

function handoffManifest(slug: string): HandoffManifest {
  return {
    schema_version: 1,
    slug,
    name: slug,
    handoffs: [
      {
        slug: `${slug}-step`,
        from: 'source-operator',
        to: 'target-operator',
        trigger: `${slug}-ready`,
      },
    ],
  }
}

describe('resolveQuestRecipes', () => {
  it('returns ok with resolved recipes when all references exist', () => {
    const recipes = createRecipeRegistry()
    recipes.add(recipe('doc-writer'))
    recipes.add(recipe('researcher'))

    const q = quest('runner', ['doc-writer', 'researcher'])
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

    const q = quest('runner', ['doc-writer', 'missing-a', 'missing-b'])
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

describe('resolveQuestHandoffManifests', () => {
  it('returns ok with resolved handoff manifests when all references exist', () => {
    const handoffs = createHandoffManifestRegistry()
    handoffs.add(handoffManifest('acme-agent-handoffs'))
    handoffs.add(handoffManifest('acme-archive-handoffs'))

    const q = quest('acme', [], ['acme-agent-handoffs', 'acme-archive-handoffs'])
    const result = resolveQuestHandoffManifests(q, handoffs)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved.map((manifest) => manifest.slug)).toEqual([
      'acme-agent-handoffs',
      'acme-archive-handoffs',
    ])
  })

  it('returns ok with empty list when quest has no handoff manifests', () => {
    const handoffs = createHandoffManifestRegistry()
    const q = quest('minimal')
    const result = resolveQuestHandoffManifests(q, handoffs)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved).toEqual([])
  })

  it('returns unresolved_handoff_manifest error listing all missing slugs', () => {
    const handoffs = createHandoffManifestRegistry()
    handoffs.add(handoffManifest('acme-agent-handoffs'))

    const q = quest('acme', [], ['acme-agent-handoffs', 'missing-a', 'missing-b'])
    const result = resolveQuestHandoffManifests(q, handoffs)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('unresolved_handoff_manifest')
    expect(result.error.unresolved).toEqual(['missing-a', 'missing-b'])
  })

  it('preserves handoff manifest order from the quest manifest', () => {
    const handoffs = createHandoffManifestRegistry()
    handoffs.add(handoffManifest('c'))
    handoffs.add(handoffManifest('a'))
    handoffs.add(handoffManifest('b'))

    const q = quest('ordered', [], ['c', 'a', 'b'])
    const result = resolveQuestHandoffManifests(q, handoffs)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.resolved.map((manifest) => manifest.slug)).toEqual(['c', 'a', 'b'])
  })
})

describe('end-to-end parse + registry + resolve', () => {
  it('loads a quest and recipes from YAML and resolves references', () => {
    const questYaml = `
schema_version: 1
slug: runner
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

    const loaded = quests.get('runner')
    expect(loaded).toBeDefined()
    if (!loaded) return

    const resolved = resolveQuestRecipes(loaded, recipes)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error('expected success')
    expect(resolved.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'reviewer'])
  })
})
