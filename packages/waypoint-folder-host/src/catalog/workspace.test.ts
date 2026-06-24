import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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

  it('collects (does not throw) a malformed authored manifest as a recipe error', async () => {
    const root = await tempProject()
    const dir = join(root, '.waypoint', 'recipes')
    await mkdir(dir, { recursive: true })
    const badPath = join(dir, 'broken.yaml')
    await writeFile(badPath, 'schema_version: 2\nslug: broken\n', 'utf8') // wrong schema_version

    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.recipeErrors).toHaveLength(1)
    expect(catalog.recipeErrors[0]).toMatchObject({ slug: 'broken', message: expect.stringMatching(/invalid Recipe manifest/) })
    expect(catalog.recipeErrors[0].relativePath).toContain('broken.yaml')
    // Bundled recipes are still fully available — one bad file does not blank the catalog.
    expect(catalog.recipes.size).toBeGreaterThan(0)
  })

  it('a malformed UNRELATED recipe does not break resolution of a valid authored quest', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'authored-quest', ['authored-recipe'])
    await writeWorkspaceRecipe(root, 'authored-recipe')
    // A half-written, unrelated recipe the quest never references.
    const dir = join(root, '.waypoint', 'recipes')
    await writeFile(join(dir, 'half-written.yaml'), 'schema_version: 1\nslug:', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('authored-quest')

    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.recipes.map((r) => r.slug)).toEqual(['authored-recipe'])
    // The bad file is surfaced as a warning, not an exception.
    expect(catalog.recipeErrors.some((e) => e.relativePath.includes('half-written.yaml'))).toBe(true)
  })

  it('resolveQuestRecipes fails loud with a parse-specific message when a referenced recipe is malformed', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'needs-bad', ['bad-recipe'])
    const dir = join(root, '.waypoint', 'recipes')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad-recipe.yaml'), 'schema_version: 2\nslug: bad-recipe\nname: Bad\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('needs-bad')

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.message).toMatch(/unresolved recipe slug/)
      expect(resolved.message).toMatch(/bad-recipe \(failed to parse/)
    }
  })

  it('resolveQuestRecipes fails loud naming the parse error when the started quest itself is malformed', async () => {
    const root = await tempProject()
    const dir = join(root, '.waypoint', 'quests')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken-quest.yaml'), 'schema_version: 2\nslug: broken-quest\nname: Broken\nworkflow: w.md\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('broken-quest')

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/Quest 'broken-quest' failed to parse/)
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
