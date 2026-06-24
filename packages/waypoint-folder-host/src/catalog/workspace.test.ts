import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from './bundled.ts'
import { loadWorkspaceWaypointCatalog } from './workspace.ts'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wp-ws-catalog-'))
}

async function writeWorkspaceQuest(root: string, slug: string, recipes: string[]): Promise<void> {
  const dir = join(root, '.waypoint', 'quests')
  await mkdir(dir, { recursive: true })
  const recipeLines = recipes.length ? `recipes:\n${recipes.map((r) => `  - ${r}`).join('\n')}\n` : ''
  await writeFile(
    join(dir, `${slug}.yaml`),
    `schema_version: 1\nslug: ${slug}\nname: ${slug} quest\nworkflow: workflows/${slug}.md\n${recipeLines}`,
    'utf8',
  )
}

async function writeWorkspaceRecipe(root: string, slug: string, name = `${slug} recipe`): Promise<void> {
  const dir = join(root, '.waypoint', 'recipes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${slug}.yaml`), `schema_version: 1\nslug: ${slug}\nname: ${name}\n`, 'utf8')
}

describe('loadWorkspaceWaypointCatalog', () => {
  it('resolves an authored-only quest + recipe not present in the bundle', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'authored-quest', ['authored-recipe'])
    await writeWorkspaceRecipe(root, 'authored-recipe')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('authored-quest')

    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.recipes.map((r) => r.slug)).toEqual(['authored-recipe'])
    }
  })

  it('lets a workspace recipe shadow a bundled recipe of the same slug', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    const bundledSlug = bundled.recipes.list()[0].slug // a real bundled recipe slug
    await writeWorkspaceRecipe(root, bundledSlug, 'SHADOWED name')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const entry = catalog.recipeEntries.find((e) => e.slug === bundledSlug)

    expect(entry?.manifest.name).toBe('SHADOWED name')
    expect(catalog.recipes.size).toBe(bundled.recipes.size) // shadow, not add
    expect(entry?.path).toContain(join('.waypoint', 'recipes')) // winning entry points at the workspace file
  })

  it('falls back to bundled-only when .waypoint dirs are missing (no throw)', async () => {
    const root = await tempProject() // no .waypoint/ at all
    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.quests.size).toBeGreaterThan(0) // bundled quests still present
  })

  it('treats an empty-but-present .waypoint/quests dir as bundled-only', async () => {
    const root = await tempProject()
    await mkdir(join(root, '.waypoint', 'quests'), { recursive: true })

    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.quests.size).toBeGreaterThan(0)
  })

  it('throws the existing parse error (with the workspace path) on a malformed authored manifest', async () => {
    const root = await tempProject()
    const dir = join(root, '.waypoint', 'recipes')
    await mkdir(dir, { recursive: true })
    const badPath = join(dir, 'broken.yaml')
    await writeFile(badPath, 'schema_version: 2\nslug: broken\n', 'utf8') // wrong schema_version

    await expect(loadWorkspaceWaypointCatalog(root)).rejects.toThrow(/invalid Recipe manifest/)
  })

  it('produces slug-sorted merged quest entries including authored + bundled', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'zzz-authored', [])

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const slugs = catalog.questEntries.map((e) => e.slug)

    expect(slugs).toContain('zzz-authored')
    expect(slugs).toContain('waypoint') // a bundled quest
    expect([...slugs]).toEqual([...slugs].sort((a, b) => a.localeCompare(b)))
  })
})
