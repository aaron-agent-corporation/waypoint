#!/usr/bin/env node
// Generate docs/runner-quest-catalog.md (and the P8 close-out counts in the two
// status docs) from the Quest and Recipe manifests on disk.
//
//   pnpm docs:catalog          rewrite the docs
//   pnpm docs:catalog:check    exit 1 if the committed docs differ from a fresh
//                              generation (used by the docs test / pre-commit)
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const {
  CATALOG_COUNT_DOC_PATHS,
  QUEST_CATALOG_DOC_PATH,
  applyCatalogCounts,
  collectQuestCatalogData,
  renderQuestCatalog,
} = await import(resolve(repoRoot, 'src/docs/quest-catalog.ts'))

const check = process.argv.includes('--check')

const data = await collectQuestCatalogData(repoRoot)
const targets = [
  { path: QUEST_CATALOG_DOC_PATH, next: renderQuestCatalog(data) },
  ...(await Promise.all(
    CATALOG_COUNT_DOC_PATHS.map(async (path) => ({
      path,
      next: applyCatalogCounts(await readFile(resolve(repoRoot, path), 'utf8'), data.counts),
    })),
  )),
]

const stale = []
for (const { path, next } of targets) {
  const current = await readFile(resolve(repoRoot, path), 'utf8').catch(() => null)
  if (current === next) continue
  stale.push(path)
  if (!check) await writeFile(resolve(repoRoot, path), next, 'utf8')
}

const { questCount, recipeCount, sourceDerivedRecipeCount, commandMappingCount } = data.counts
const summary = `${questCount} Quests, ${recipeCount} Recipes (${sourceDerivedRecipeCount} source-derived), ${commandMappingCount} command mappings`

if (check) {
  if (stale.length > 0) {
    console.error(`Generated docs are stale (${summary}):`)
    for (const path of stale) console.error(`  - ${path}`)
    console.error('\nRun `pnpm docs:catalog` and commit the result.')
    process.exit(1)
  }
  console.log(`Generated docs are up to date — ${summary}.`)
} else {
  console.log(stale.length > 0 ? `Regenerated ${stale.join(', ')} — ${summary}.` : `No changes — ${summary}.`)
}
