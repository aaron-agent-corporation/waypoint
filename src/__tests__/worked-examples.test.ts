import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  loadQuestsFromDirectory,
  loadRecipesFromDirectory,
  resolveQuestRecipes,
} from '../index.js'

// This test loads the real `quests/` and `recipes/` directories at the repo
// root and verifies the worked examples round-trip through the loaders and
// cross-resolve cleanly. It's intentionally end-to-end.

const here = dirname(fileURLToPath(import.meta.url))
// here = /.../waypoint/src/__tests__ → go up 2 levels to repo root
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

describe('worked examples at repo root', () => {
  it('loads quests/example.yaml and resolves its recipe references', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error('quest load failed')
    expect(quests.registry.has('example')).toBe(true)

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))
    expect(recipes.registry.has('doc-writer')).toBe(true)
    expect(recipes.registry.has('reviewer')).toBe(true)
    // Recursive loader also picks up ported GSD recipes under recipes/gsd/.
    expect(recipes.registry.has('gsd-doc-writer')).toBe(true)

    const example = quests.registry.get('example')
    expect(example).toBeDefined()
    if (!example) return

    const resolved = resolveQuestRecipes(example, recipes.registry)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error))
    expect(resolved.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'reviewer'])
  })
})
