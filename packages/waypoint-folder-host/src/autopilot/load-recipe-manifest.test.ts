import { mkdtemp } from 'node:fs/promises'
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
})
