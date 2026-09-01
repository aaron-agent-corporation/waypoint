/**
 * installQuestCatalog — a case's recipes must not be frozen at creation.
 *
 * The old rule never rewrote a recipe that was already there, so every prompt
 * fix reached new cases only. Robin Vance ran a 4-day-old document-intake
 * recipe on 2026-07-27 and filed fifteen individual clinicians as medical
 * providers; the rule forbidding that had shipped six hours earlier
 * (Aaron 2026-07-27). These tests pin the distinction that replaced it: a file
 * we can prove we wrote is refreshed, a file we cannot is preserved and named.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildWaypointCatalog, loadQuestEntries, loadRecipeEntries, type BundledWaypointCatalog } from './bundled.ts'
import { installQuestCatalog } from './install.ts'

const RECIPE_PATH = join('.waypoint', 'recipes', 'r-one.yaml')

async function fakeBundle(
  recipeBody: string,
  questBody?: string,
  skills?: Readonly<Record<string, string>>,
): Promise<BundledWaypointCatalog> {
  const root = await mkdtemp(join(tmpdir(), 'wp-bundle-'))
  const questsDir = join(root, 'quests')
  const recipesDir = join(root, 'recipes')
  await mkdir(questsDir, { recursive: true })
  await mkdir(recipesDir, { recursive: true })
  await writeFile(
    join(questsDir, 'q.yaml'),
    questBody ??
      'schema_version: 1\nslug: q\nname: Q quest\nworkflow: workflows/q.md\nrecipes:\n  - r-one\n',
    'utf8',
  )
  await writeFile(join(recipesDir, 'r-one.yaml'), recipeBody, 'utf8')
  const skillsDir = join(root, 'skills')
  if (skills) {
    for (const [rel, body] of Object.entries(skills)) {
      await mkdir(join(skillsDir, rel, '..'), { recursive: true })
      await writeFile(join(skillsDir, rel), body, 'utf8')
    }
  }
  const quests = await loadQuestEntries(questsDir)
  const recipes = await loadRecipeEntries(recipesDir)
  return buildWaypointCatalog({
    root,
    questsDir,
    recipesDir,
    skillsDir,
    questEntries: quests.entries,
    recipeEntries: recipes.entries,
    questErrors: [],
    recipeErrors: [],
  })
}

const V1 = 'schema_version: 1\nslug: r-one\nname: R One\nprompt: the old prompt\n'
const V2 = 'schema_version: 1\nslug: r-one\nname: R One\nprompt: a provider is an organization\n'

async function caseRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wp-case-'))
}

async function installedRecipe(root: string): Promise<string> {
  return readFile(join(root, RECIPE_PATH), 'utf8')
}

describe('installQuestCatalog keeps a case current', () => {
  it('installs a recipe the case does not have', async () => {
    const root = await caseRoot()
    const result = await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    expect(result.installedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(V1)
  })

  it('refreshes a recipe it installed when the bundle moves on', async () => {
    // The whole point: a fix shipped after the case was created reaches it.
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    const result = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q' })
    expect(result.refreshedRecipePaths).toEqual([RECIPE_PATH])
    expect(result.divergedRecipePaths).toEqual([])
    expect(await installedRecipe(root)).toBe(V2)
  })

  it('never clobbers an operator edit — it reports it', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    const edited = `${V1}# the operator's own line\n`
    await writeFile(join(root, RECIPE_PATH), edited, 'utf8')

    const result = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q' })
    expect(result.refreshedRecipePaths).toEqual([])
    expect(result.divergedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(edited)
  })

  it('preserves a file it cannot prove it wrote, until an operator adopts', async () => {
    // A case older than the manifest: staleness and a hand edit look identical,
    // so the automatic path keeps the file and names it.
    const root = await caseRoot()
    await mkdir(join(root, '.waypoint', 'recipes'), { recursive: true })
    await writeFile(join(root, RECIPE_PATH), V1, 'utf8')

    const auto = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q' })
    expect(auto.divergedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(V1)

    const adopted = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q', adoptUnmanaged: true })
    expect(adopted.refreshedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(V2)
  })

  it('adopts once, then manages the file from then on', async () => {
    const root = await caseRoot()
    await mkdir(join(root, '.waypoint', 'recipes'), { recursive: true })
    await writeFile(join(root, RECIPE_PATH), V1, 'utf8')
    await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q', adoptUnmanaged: true })

    // No --adopt this time: the adopted file is ours, so a later bundle change
    // refreshes it without the operator asking again.
    const V3 = `${V2}# and one more rule\n`
    const result = await installQuestCatalog(root, await fakeBundle(V3), { quest: 'q' })
    expect(result.refreshedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(V3)
  })

  it('adopts a file that already matches the bundle without touching it', async () => {
    const root = await caseRoot()
    await mkdir(join(root, '.waypoint', 'recipes'), { recursive: true })
    await writeFile(join(root, RECIPE_PATH), V2, 'utf8')

    const result = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q' })
    expect(result.refreshedRecipePaths).toEqual([])
    expect(result.divergedRecipePaths).toEqual([])
    // Seeded into the manifest, so the NEXT change refreshes it.
    const next = await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    expect(next.refreshedRecipePaths).toEqual([RECIPE_PATH])
  })

  it('treats an unreadable manifest as proof of nothing', async () => {
    // Fail safe: if we cannot read what we wrote, everything is someone else's.
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    await writeFile(join(root, '.waypoint', 'catalog-install.yaml'), ': not: yaml: [', 'utf8')

    const result = await installQuestCatalog(root, await fakeBundle(V2), { quest: 'q' })
    expect(result.divergedRecipePaths).toEqual([RECIPE_PATH])
    expect(await installedRecipe(root)).toBe(V1)
  })
})

describe('the quest file is kept current too', () => {
  // The contact-intake de-gating (2026-08-15) never reached the live case:
  // preserveExistingQuest pinned the installed quest forever, so every new
  // emission compiled the retired gate back into its route — the recipe
  // pinning failure, replayed on the quest itself.
  const QUEST_PATH = join('.waypoint', 'quests', 'q.yaml')
  const QUEST_V1 =
    'schema_version: 1\nslug: q\nname: Q quest\nworkflow: workflows/q.md\nrecipes:\n  - r-one\n'
  const QUEST_V2 =
    'schema_version: 1\nslug: q\nname: Q quest de-gated\nworkflow: workflows/q.md\nrecipes:\n  - r-one\n'

  it('refreshes a preserved quest we installed when the bundle moves on', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1, QUEST_V1), { quest: 'q' })

    const result = await installQuestCatalog(root, await fakeBundle(V1, QUEST_V2), {
      quest: 'q',
      preserveExistingQuest: true,
    })
    expect(result.refreshedQuestPaths).toEqual([QUEST_PATH])
    expect(result.divergedQuestPaths).toEqual([])
    expect(await readFile(join(root, QUEST_PATH), 'utf8')).toBe(QUEST_V2)
  })

  it('preserves and names a hand-edited quest', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1, QUEST_V1), { quest: 'q' })
    const edited = QUEST_V1.replace('Q quest', 'Q quest (operator tuned)')
    await writeFile(join(root, QUEST_PATH), edited, 'utf8')

    const result = await installQuestCatalog(root, await fakeBundle(V1, QUEST_V2), {
      quest: 'q',
      preserveExistingQuest: true,
    })
    expect(result.refreshedQuestPaths).toEqual([])
    expect(result.divergedQuestPaths).toEqual([QUEST_PATH])
    expect(await readFile(join(root, QUEST_PATH), 'utf8')).toBe(edited)
  })

  it('a case predating the quest manifest refreshes once seeded', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1, QUEST_V1), { quest: 'q' })
    // Simulate a pre-manifest case: forget the quests section entirely.
    const manifestPath = join(root, '.waypoint', 'catalog-install.yaml')
    const manifest = await readFile(manifestPath, 'utf8')
    await writeFile(manifestPath, manifest.replace(/quests:[\s\S]*$/, ''), 'utf8')

    // Identical copy seeds the manifest; the next bundle change refreshes.
    await installQuestCatalog(root, await fakeBundle(V1, QUEST_V1), {
      quest: 'q',
      preserveExistingQuest: true,
    })
    const result = await installQuestCatalog(root, await fakeBundle(V1, QUEST_V2), {
      quest: 'q',
      preserveExistingQuest: true,
    })
    expect(result.refreshedQuestPaths).toEqual([QUEST_PATH])
    expect(await readFile(join(root, QUEST_PATH), 'utf8')).toBe(QUEST_V2)
  })
})


/**
 * Skills are catalog content, so they install and refresh under the same rule
 * recipes do. Before this a shipped cordis recipe's skills had to be hand-copied
 * into every case, which is the recipe-pinning failure wearing a new hat: the
 * repo fixes the discipline, and no existing case ever sees it.
 */
describe('installQuestCatalog — bundled skills', () => {
  const SKILLS = { 'medical-layer/cite-discipline.md': 'Pin-cite everything.\n' }
  const SKILL_PATH = join('.waypoint', 'skills', 'medical-layer', 'cite-discipline.md')

  it('installs the bundle\'s skills into a case that has none', async () => {
    const root = await caseRoot()
    const result = await installQuestCatalog(root, await fakeBundle(V1, undefined, SKILLS), { quest: 'q' })
    expect(result.installedSkillPaths).toContain(SKILL_PATH)
    expect(await readFile(join(root, SKILL_PATH), 'utf8')).toBe('Pin-cite everything.\n')
  })

  it('refreshes a skill it installed when the bundle moves on', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1, undefined, SKILLS), { quest: 'q' })
    const moved = { 'medical-layer/cite-discipline.md': 'Pin-cite everything, and quote the value.\n' }
    const result = await installQuestCatalog(root, await fakeBundle(V1, undefined, moved), { quest: 'q' })
    expect(result.refreshedSkillPaths).toContain(SKILL_PATH)
    expect(await readFile(join(root, SKILL_PATH), 'utf8')).toContain('quote the value')
  })

  it('preserves and REPORTS a skill an operator edited, rather than clobbering it', async () => {
    const root = await caseRoot()
    await installQuestCatalog(root, await fakeBundle(V1, undefined, SKILLS), { quest: 'q' })
    await writeFile(join(root, SKILL_PATH), 'This case has its own rule.\n', 'utf8')
    const moved = { 'medical-layer/cite-discipline.md': 'Pin-cite everything, and quote the value.\n' }
    const result = await installQuestCatalog(root, await fakeBundle(V1, undefined, moved), { quest: 'q' })
    expect(result.divergedSkillPaths).toContain(SKILL_PATH)
    expect(result.refreshedSkillPaths).not.toContain(SKILL_PATH)
    expect(await readFile(join(root, SKILL_PATH), 'utf8')).toBe('This case has its own rule.\n')
  })

  it('is a no-op on a bundle with no skills dir at all', async () => {
    const root = await caseRoot()
    const result = await installQuestCatalog(root, await fakeBundle(V1), { quest: 'q' })
    expect(result.installedSkillPaths).toEqual([])
  })
})
