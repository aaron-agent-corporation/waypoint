import { describe, expect, it } from 'vitest'

import type { WaypointFolderTask } from './engine/types'
import { recipeSlugOf, resolveRecipe, type Recipe } from './recipe'

function task(metadata: WaypointFolderTask['metadata']): Pick<WaypointFolderTask, 'metadata'> {
  return { metadata }
}

describe('recipeSlugOf', () => {
  it('reads the nested folder-host path metadata.waypoint.recipe.slug', () => {
    expect(recipeSlugOf(task({ waypoint: { recipe: { slug: 'waypoint-code-reviewer' } } }))).toBe('waypoint-code-reviewer')
  })

  it('reads the flat Beads path metadata.waypoint.recipe_slug', () => {
    expect(recipeSlugOf(task({ waypoint: { recipe_slug: 'waypoint-doc-writer' } }))).toBe('waypoint-doc-writer')
  })

  it('prefers the nested path when both are present', () => {
    expect(recipeSlugOf(task({ waypoint: { recipe: { slug: 'nested' }, recipe_slug: 'flat' } }))).toBe('nested')
  })

  it('returns null for empty slug, missing waypoint, missing metadata, or string metadata', () => {
    expect(recipeSlugOf(task({ waypoint: { recipe: { slug: '' } } }))).toBeNull()
    expect(recipeSlugOf(task({ waypoint: {} }))).toBeNull()
    expect(recipeSlugOf(task({}))).toBeNull()
    expect(recipeSlugOf(task(undefined))).toBeNull()
    expect(recipeSlugOf({ metadata: 'a json string' as unknown as WaypointFolderTask['metadata'] })).toBeNull()
  })
})

describe('resolveRecipe', () => {
  const reviewer: Recipe = { slug: 'reviewer', name: 'Reviewer' }
  const globalOnly: Recipe = { slug: 'global-only', name: 'Global' }
  const caches = { recipesByQuest: { waypoint: [reviewer] }, recipesAll: [globalOnly] }

  it('prefers the active quest cache', () => {
    expect(resolveRecipe('reviewer', 'waypoint', caches)).toBe(reviewer)
  })

  it('falls back to the global cache', () => {
    expect(resolveRecipe('global-only', 'waypoint', caches)).toBe(globalOnly)
  })

  it('returns undefined when present in neither loaded scope', () => {
    expect(resolveRecipe('missing', 'waypoint', { recipesByQuest: {}, recipesAll: null })).toBeUndefined()
    expect(resolveRecipe('reviewer', undefined, { recipesByQuest: {}, recipesAll: null })).toBeUndefined()
  })
})
