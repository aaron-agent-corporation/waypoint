import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRecipeManifest } from './run.ts'
import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'

describe('autopilot loadRecipeManifest default path', () => {
  it('loads a bundled recipe slug not copied into .waypoint/recipes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-autopilot-recipe-')) // no .waypoint/recipes
    const bundled = await loadBundledWaypointCatalog()
    const someBundledSlug = bundled.recipes.list()[0].slug

    const manifest = await loadRecipeManifest(root, someBundledSlug)
    expect(manifest.slug).toBe(someBundledSlug)
  })

  it('loads an authored recipe (with prompt) from .waypoint/recipes via the autopilot execution path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-authored-recipe-'))
    const recipesDir = join(root, '.waypoint', 'recipes')
    await mkdir(recipesDir, { recursive: true })
    const slug = 'authored-do-work'
    const yaml = `schema_version: 1\nslug: ${slug}\nname: Authored Do Work\nprompt: Do the work.\n`
    await writeFile(join(recipesDir, `${slug}.yaml`), yaml, 'utf8')

    const manifest = await loadRecipeManifest(root, slug)
    expect(manifest.slug).toBe(slug)
    expect(manifest.prompt).toBeTruthy()
    expect(manifest.prompt.trim().length).toBeGreaterThan(0)
  })
})
