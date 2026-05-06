import { describe, it, expect } from 'vitest'
import { createRecipeRegistry } from '../registry.js'
import type { RecipeManifest } from '../manifest.js'

function sampleRecipe(slug: string, overrides: Partial<RecipeManifest> = {}): RecipeManifest {
  return {
    schema_version: 1,
    slug,
    name: slug,
    prompt: `prompt for ${slug}`,
    ...overrides,
  }
}

describe('createRecipeRegistry', () => {
  it('starts empty', () => {
    const r = createRecipeRegistry()
    expect(r.size).toBe(0)
    expect(r.list()).toEqual([])
  })

  it('adds a manifest and returns ok', () => {
    const r = createRecipeRegistry()
    const result = r.add(sampleRecipe('doc-writer'))
    expect(result.ok).toBe(true)
    expect(r.size).toBe(1)
    expect(r.has('doc-writer')).toBe(true)
    expect(r.get('doc-writer')?.slug).toBe('doc-writer')
  })

  it('returns slug_collision error on duplicate slug', () => {
    const r = createRecipeRegistry()
    r.add(sampleRecipe('doc-writer'))
    const result = r.add(sampleRecipe('doc-writer'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('slug_collision')
  })

  it('rejects invalid manifest shape', () => {
    const r = createRecipeRegistry()
    const result = r.add({ not: 'a recipe' } as unknown as RecipeManifest)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_manifest')
  })

  it('list returns sorted array by slug', () => {
    const r = createRecipeRegistry()
    r.add(sampleRecipe('z'))
    r.add(sampleRecipe('a'))
    r.add(sampleRecipe('m'))
    expect(r.list().map((x) => x.slug)).toEqual(['a', 'm', 'z'])
  })
})
