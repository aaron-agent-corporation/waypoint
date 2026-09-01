import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadQuestsFromDirectory, loadRecipesFromDirectory } from '../index.ts'
import {
  CATALOG_COUNT_DOC_PATHS,
  QUEST_CATALOG_DOC_PATH,
  applyCatalogCounts,
  collectQuestCatalogData,
  renderQuestCatalog,
} from '../docs/quest-catalog.ts'

const repoRoot = resolve(__dirname, '../..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Waypoint Quest operator documentation', () => {
  it('links the operator guide and command map from the README', () => {
    const readme = readRepoFile('README.md')

    expect(readme).toContain('docs/quests/runner.md')
    expect(readme).toContain('docs/quests/runner-command-map.md')
  })

  it('explains the operator workflow, human gates, recipes, adaptations, and deferred scope', () => {
    const guide = readRepoFile('docs/quests/runner.md')

    for (const phrase of [
      'initialize → discuss → plan → execute → verify → ship',
      'Quest is the user-facing journey template',
      'Recipe is the reusable agent definition',
      'Humans intervene',
      'task-scoped discussion',
      'plan approval gate',
      'verification gate',
      'ship approval gate',
      'not implemented yet',
      'does not implement a standalone source CLI',
    ]) {
      expect(guide).toContain(phrase)
    }
  })

  it('publishes a human-readable command map backed by all 65 YAML mappings', () => {
    const sourceMap = readRepoFile('docs/quests/runner-command-map.yaml')
    const markdownMap = readRepoFile('docs/quests/runner-command-map.md')
    const sourceCommands = Array.from(
      sourceMap.matchAll(/^\s+- source_command: commands\/gsd\/(.+)$/gm),
      ([, command]) => command,
    )

    expect(sourceCommands).toHaveLength(65)
    expect(markdownMap).toContain('Generated from `docs/quests/runner-command-map.yaml`')

    for (const command of sourceCommands) {
      expect(markdownMap).toContain(`commands/gsd/${command}`)
    }

    for (const phrase of [
      '`/waypoint pause`',
      '`/waypoint resume`',
      '`/waypoint auto`',
      'deferred optional namespace commands',
      '`quests/runner.yaml`',
    ]) {
      expect(markdownMap).toContain(phrase)
    }
  })

  async function loadCatalogCounts() {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const questSlugs = quests.registry.list().map((quest) => quest.slug).sort()
    const recipeSlugs = recipes.registry.list().map((recipe) => recipe.slug).sort()
    const gsdRecipeSlugs = recipeSlugs.filter((slug) => slug.startsWith('runner-'))

    return { questSlugs, recipeSlugs, gsdRecipeSlugs }
  }

  it('publishes a catalog with loader-backed Quest and Recipe counts plus attribution', async () => {
    const { questSlugs, recipeSlugs, gsdRecipeSlugs } = await loadCatalogCounts()
    const catalog = readRepoFile('docs/runner-quest-catalog.md')

    expect(catalog).toContain(`Total Quests loaded from disk: ${questSlugs.length}`)
    expect(catalog).toContain(`Total Recipes loaded from disk: ${recipeSlugs.length}`)
    expect(catalog).toContain(`Waypoint source-derived Recipes: ${gsdRecipeSlugs.length}`)
    expect(catalog).toContain('MIT License')
    expect(catalog).toContain('Copyright (c) 2025 Lex Christopherson')
    expect(catalog).toContain('third_party/gsd/LICENSE')
    expect(catalog).toContain('third_party/gsd/NOTICE.md')

    for (const slug of [...questSlugs, ...recipeSlugs]) {
      expect(catalog).toContain(`\`${slug}\``)
    }
  })

  it('keeps the committed catalog byte-identical to a fresh generation', async () => {
    const data = await collectQuestCatalogData(repoRoot)
    const committed = readRepoFile(QUEST_CATALOG_DOC_PATH)

    // The catalog is generated, not hand-maintained: it drifted by 8 Quests and
    // 33 Recipes while claiming otherwise. Any manifest change must be followed
    // by `pnpm docs:catalog`.
    expect(committed, `${QUEST_CATALOG_DOC_PATH} is stale — run \`pnpm docs:catalog\``).toBe(renderQuestCatalog(data))

    for (const path of CATALOG_COUNT_DOC_PATHS) {
      const doc = readRepoFile(path)
      expect(doc, `${path} carries stale counts — run \`pnpm docs:catalog\``).toBe(applyCatalogCounts(doc, data.counts))
    }
  })
})
