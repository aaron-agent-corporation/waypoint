import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

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

  it('B0: a malformed workspace recipe colliding with a bundled slug fails loud, not silently running the bundled twin', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    const bundledSlug = bundled.recipes.list()[0].slug // a real bundled recipe slug
    await writeWorkspaceQuest(root, 'override-quest', [bundledSlug])
    const dir = join(root, '.waypoint', 'recipes')
    await mkdir(dir, { recursive: true })
    // Malformed override claiming the bundled slug (wrong schema_version).
    await writeFile(join(dir, `${bundledSlug}.yaml`), `schema_version: 2\nslug: ${bundledSlug}\nname: Broken Override\n`, 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    // The bundled twin must NOT silently win the merged registry.
    expect(catalog.recipes.get(bundledSlug)).toBeUndefined()
    const resolved = catalog.resolveQuestRecipes('override-quest')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/failed to parse/)
  })

  it('B0: a malformed workspace quest colliding with a bundled quest slug fails loud, not resolving the bundled twin', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    const bundledQuestSlug = bundled.quests.list()[0].slug
    const dir = join(root, '.waypoint', 'quests')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${bundledQuestSlug}.yaml`),
      `schema_version: 2\nslug: ${bundledQuestSlug}\nname: Broken\nworkflow: w.md\n`,
      'utf8',
    )

    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.quests.get(bundledQuestSlug)).toBeUndefined()
    const resolved = catalog.resolveQuestRecipes(bundledQuestSlug)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/failed to parse/)
  })

  it('B0 (slug-less, nested slug≠basename): a malformed override at a bundled recipe PATH tombstones the twin', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    // Prefer a nested entry whose declared slug differs from its filename basename
    // (e.g. agentic-delivery/verification-before-completion.yaml) — the exact case
    // a basename-keyed tombstone would miss.
    const twin =
      bundled.recipeEntries.find(
        (e) => e.relativePath.includes('/') && basename(e.relativePath).replace(/\.ya?ml$/, '') !== e.slug,
      ) ?? bundled.recipeEntries[0]
    await writeWorkspaceQuest(root, 'override-quest', [twin.slug])
    const dest = join(root, '.waypoint', 'recipes', twin.relativePath)
    await mkdir(dirname(dest), { recursive: true })
    // `slug:` is null → slug-less; identity must come from the exact relativePath.
    await writeFile(dest, 'schema_version: 1\nslug:\nname: Broken\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    // The bundled twin is tombstoned despite the missing slug AND slug≠basename —
    // no silent survival of bundled executable content.
    expect(catalog.recipes.get(twin.slug)).toBeUndefined()
    // Surfaced as a path-keyed error so the listing names the broken file.
    expect(catalog.recipeErrors.some((e) => e.relativePath === twin.relativePath)).toBe(true)
    const resolved = catalog.resolveQuestRecipes('override-quest')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/failed to parse/)
  })

  it('B0 (slug-less): a malformed quest override at a bundled quest PATH tombstones the twin', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    const twin = bundled.questEntries[0]
    const dest = join(root, '.waypoint', 'quests', twin.relativePath)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, 'schema_version: 1\nslug:\nname: Broken\nworkflow: w.md\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.quests.get(twin.slug)).toBeUndefined()
    const resolved = catalog.resolveQuestRecipes(twin.slug)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/failed to parse/)
  })

  it('B0 (over-tombstone guard): a malformed override declaring a foreign slug leaves the unrelated bundled entry it is named after alive', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    const victim = bundled.recipes.list()[0].slug // a valid bundled recipe that must survive
    const dir = join(root, '.waypoint', 'recipes')
    await mkdir(dir, { recursive: true })
    // File is named <victim>.yaml but DECLARES a different slug (and is malformed):
    // only the declared slug may be tombstoned — never the filename.
    await writeFile(join(dir, `${victim}.yaml`), 'schema_version: 2\nslug: decoy-elsewhere\nname: Decoy\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    expect(catalog.recipes.get(victim)).toBeDefined() // unrelated bundled entry survives
  })

  it('B1: a started quest too malformed to yield a slug still fails loud with a parse message (filename fallback)', async () => {
    const root = await tempProject()
    const dir = join(root, '.waypoint', 'quests')
    await mkdir(dir, { recursive: true })
    // `slug:` parses to null, so readSlugLenient yields undefined — only the filename scopes it.
    await writeFile(join(dir, 'halfwritten.yaml'), 'schema_version: 1\nslug:\nname: Half\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('halfwritten')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.message).toMatch(/Quest 'halfwritten' failed to parse/)
  })

  it('within-workspace duplicate slug: a valid entry wins even when another file declares the same slug malformed', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'needs-x', ['dup-x'])
    await writeWorkspaceRecipe(root, 'dup-x') // valid recipe, slug dup-x
    // A second file ALSO declaring slug dup-x, but malformed.
    const dir = join(root, '.waypoint', 'recipes')
    await writeFile(join(dir, 'dup-x-broken.yaml'), 'schema_version: 2\nslug: dup-x\nname: Broken\n', 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes('needs-x')

    // Valid-wins (slug last-wins merge): dup-x resolves to the valid file, NOT unresolved.
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.recipes.map((r) => r.slug)).toEqual(['dup-x'])
    // The malformed file is surfaced as a warning naming the FILE — it does not imply
    // the (resolved) slug dup-x is unresolved.
    expect(catalog.recipeErrors.some((e) => e.relativePath.includes('dup-x-broken.yaml'))).toBe(true)
  })

  it('a malformed override of a bundled recipe makes a BUNDLED quest referencing it fail loud, naming the override file', async () => {
    const root = await tempProject()
    const bundled = await loadBundledWaypointCatalog()
    // Find a bundled quest that references at least one bundled recipe.
    let questSlug: string | undefined
    let recipe: { slug: string; relativePath: string } | undefined
    for (const q of bundled.questEntries) {
      const r = bundled.resolveQuestRecipes(q.slug)
      if (r.ok && r.recipeEntries.length > 0) {
        questSlug = q.slug
        recipe = { slug: r.recipeEntries[0].slug, relativePath: r.recipeEntries[0].relativePath }
        break
      }
    }
    if (!questSlug || !recipe) throw new Error('no bundled quest with a referenced recipe found')

    // Malformed workspace override at the bundled recipe's exact relative path.
    const dest = join(root, '.waypoint', 'recipes', recipe.relativePath)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, `schema_version: 2\nslug: ${recipe.slug}\nname: Broken\n`, 'utf8')

    const catalog = await loadWorkspaceWaypointCatalog(root)
    const resolved = catalog.resolveQuestRecipes(questSlug)

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.message).toMatch(/failed to parse/)
      // Attributes the failure to the authored override file, not the bundled quest.
      expect(resolved.message).toContain(recipe.relativePath)
    }
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
