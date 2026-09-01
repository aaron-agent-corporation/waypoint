import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { loadQuestsFromDirectory } from '../quests/loader.ts'
import { parseQuestManifest, type QuestManifest } from '../quests/manifest.ts'
import { loadRecipesFromDirectory } from '../recipes/loader.ts'
import { parseRecipeManifest, type RecipeManifest } from '../recipes/manifest.ts'

/**
 * Generator for `docs/runner-quest-catalog.md`.
 *
 * The catalog used to claim it was "generated from the manifests currently
 * present on disk" while being hand-maintained; it drifted by 8 Quests and 33
 * Recipes before anyone noticed. Everything per-Quest/per-Recipe in the doc is
 * now derived here from the SAME loaders the docs test uses
 * (`loadQuestsFromDirectory` / `loadRecipesFromDirectory`), so the claim is
 * true and the drift is a test failure rather than a slow rot.
 *
 * Narrative prose that is genuinely editorial (the intro, the attribution and
 * license section, the group blurbs, the deferred-scope list) lives in this
 * file as static text so the whole document can be byte-compared against a
 * fresh render.
 */

export const QUEST_CATALOG_DOC_PATH = 'docs/runner-quest-catalog.md'
export const COMMAND_MAP_SOURCE_PATH = 'docs/quests/runner-command-map.yaml'
export const CATALOG_COUNT_DOC_PATHS: readonly string[] = []

export type CatalogCounts = {
  readonly questCount: number
  readonly recipeCount: number
  readonly sourceDerivedRecipeCount: number
  readonly commandMappingCount: number
}

export type CatalogQuestEntry = {
  readonly manifest: QuestManifest
  /** Repo-relative, POSIX-separated path of the manifest file. */
  readonly path: string
}

export type CatalogRecipeEntry = {
  readonly manifest: RecipeManifest
  readonly path: string
}

export type QuestCatalogData = {
  readonly quests: readonly CatalogQuestEntry[]
  readonly recipes: readonly CatalogRecipeEntry[]
  readonly counts: CatalogCounts
}

/** Quest `metadata.runner.quest_family` values that get their own section. */
const PRIMARY_STARTER_FAMILY = 'primary_starter'

/**
 * Collect every Quest and Recipe on disk, with the file each came from.
 *
 * Manifests carry no path of their own, so the walk is repeated here to build
 * the slug → path map; the registries (and therefore the counts and the entry
 * set) still come from the shared loaders. Any loader error is thrown — a doc
 * generated from a half-loaded library would be worse than no doc.
 */
export async function collectQuestCatalogData(repoRoot: string): Promise<QuestCatalogData> {
  const questsDir = resolve(repoRoot, 'quests')
  const recipesDir = resolve(repoRoot, 'recipes')

  const questsResult = await loadQuestsFromDirectory(questsDir)
  if (!questsResult.ok) {
    throw new Error(`failed to load quests from ${questsDir}: ${JSON.stringify(questsResult.errors, null, 2)}`)
  }
  const recipesResult = await loadRecipesFromDirectory(recipesDir)
  if (!recipesResult.ok) {
    throw new Error(`failed to load recipes from ${recipesDir}: ${JSON.stringify(recipesResult.errors, null, 2)}`)
  }

  const questPaths = await mapSlugsToPaths(repoRoot, questsDir, (text) => {
    const parsed = parseQuestManifest(text)
    return parsed.ok ? parsed.manifest.slug : undefined
  })
  const recipePaths = await mapSlugsToPaths(repoRoot, recipesDir, (text) => {
    const parsed = parseRecipeManifest(text)
    return parsed.ok ? parsed.manifest.slug : undefined
  })

  const quests = sortBySlug(questsResult.registry.list()).map((manifest) => ({
    manifest,
    path: pathFor(questPaths, manifest.slug),
  }))
  const recipes = sortBySlug(recipesResult.registry.list()).map((manifest) => ({
    manifest,
    path: pathFor(recipePaths, manifest.slug),
  }))

  return {
    quests,
    recipes,
    counts: {
      questCount: quests.length,
      recipeCount: recipes.length,
      sourceDerivedRecipeCount: recipes.filter((entry) => entry.manifest.slug.startsWith('runner-')).length,
      commandMappingCount: await countCommandMappings(repoRoot),
    },
  }
}

/** Render the full `docs/runner-quest-catalog.md` body, newline-terminated. */
export function renderQuestCatalog(data: QuestCatalogData): string {
  const { quests, recipes, counts } = data

  const primaryStarters = quests.filter((entry) => questFamily(entry) === PRIMARY_STARTER_FAMILY)
  const otherQuests = quests.filter((entry) => questFamily(entry) !== PRIMARY_STARTER_FAMILY)

  const sections: string[] = [
    INTRO_SECTION,
    [
      '## Loader-backed counts',
      '',
      `- Total Quests loaded from disk: ${counts.questCount}`,
      `- Total Recipes loaded from disk: ${counts.recipeCount}`,
      `- Waypoint source-derived Recipes: ${counts.sourceDerivedRecipeCount}`,
      `- Source command mappings documented: ${counts.commandMappingCount}`,
      '',
      'Counts above are based on manifest files under `quests/` and `recipes/` and are covered by `src/__tests__/runner-docs.test.ts`.',
    ].join('\n'),
    ATTRIBUTION_SECTION,
    ['## Quests', '', `All ${counts.questCount} Quest manifests under \`quests/\`, grouped by \`metadata.runner.quest_family\`.`].join('\n'),
    [PRIMARY_STARTER_BLURB, '', ...primaryStarters.map(renderQuestEntry)].join('\n'),
  ]

  if (otherQuests.length > 0) {
    sections.push([OTHER_QUESTS_BLURB, '', ...otherQuests.map(renderQuestEntry)].join('\n'))
  }

  sections.push(
    [
      '## Recipes',
      '',
      `All ${counts.recipeCount} Recipe manifests under \`recipes/\`, in slug order.`,
      '',
      ...recipes.map(renderRecipeEntry),
    ].join('\n'),
    DEFERRED_SECTION,
  )

  return `${sections.join('\n\n')}\n`
}

/**
 * Rewrite the P8 close-out count lines in a status doc. Only the three count
 * lines are touched; the surrounding prose is left exactly as written.
 */
export function applyCatalogCounts(docText: string, counts: CatalogCounts): string {
  return docText
    .replace(/^- Actual Quest count: .*$/m, `- Actual Quest count: ${counts.questCount}`)
    .replace(/^- Actual Recipe count: .*$/m, `- Actual Recipe count: ${counts.recipeCount}`)
    .replace(
      /^- Waypoint source-derived Recipe count: .*$/m,
      `- Waypoint source-derived Recipe count: ${counts.sourceDerivedRecipeCount}`,
    )
}

function renderQuestEntry(entry: CatalogQuestEntry): string {
  const { manifest } = entry
  const lines = [`- \`${manifest.slug}\` — ${manifest.name}`, `  - Path: \`${entry.path}\``]
  const description = singleLine(manifest.description)
  if (description) lines.push(`  - Description: ${description}`)
  if (manifest.recipes && manifest.recipes.length > 0) {
    lines.push(`  - Recipes: ${manifest.recipes.map((slug) => `\`${slug}\``).join(', ')}`)
  }
  const attribution = sourceAttribution(manifest.metadata)
  if (attribution) lines.push(`  - Source attribution: ${attribution}`)
  return lines.join('\n')
}

function renderRecipeEntry(entry: CatalogRecipeEntry): string {
  const { manifest } = entry
  const lines = [`- \`${manifest.slug}\` — ${manifest.name}`, `  - Path: \`${entry.path}\``]
  const description = singleLine(manifest.description)
  if (description) lines.push(`  - Description: ${description}`)
  const kind = manifest.runtime?.kind
  if (kind && kind !== 'agent') lines.push(`  - Runtime kind: \`${kind}\``)
  const sideEffects = externalSideEffects(manifest.metadata)
  if (sideEffects) lines.push(`  - External side effects: \`${sideEffects}\``)
  return lines.join('\n')
}

/**
 * Descriptions are copied verbatim apart from line breaks: YAML block scalars
 * carry trailing (and occasionally internal) newlines, and a raw newline inside
 * a markdown list item ends the bullet.
 */
function singleLine(value: string | undefined): string | undefined {
  const collapsed = value?.replace(/\s*\n\s*/g, ' ').trim()
  return collapsed ? collapsed : undefined
}

function questFamily(entry: CatalogQuestEntry): string | undefined {
  return readString(readRecord(entry.manifest.metadata, 'runner'), 'quest_family')
}

/**
 * `external_side_effects` is recorded in three different metadata homes across
 * the library's generations (`runner`, `safety`, `source_port`). Read all
 * three rather than silently dropping the line for two thirds of the Recipes.
 */
function externalSideEffects(metadata: Readonly<Record<string, unknown>> | undefined): string | undefined {
  for (const key of ['runner', 'safety', 'source_port'] as const) {
    const value = readString(readRecord(metadata, key), 'external_side_effects')
    if (value) return value
  }
  return undefined
}

function sourceAttribution(metadata: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const source = readRecord(metadata, 'source')
  if (source) {
    const project = readString(source, 'project')
    if (project) {
      const details = [
        readString(source, 'path'),
        readString(source, 'license') ? `${readString(source, 'license')} licensed` : undefined,
        readString(source, 'ported_at') ? `ported ${readString(source, 'ported_at')}` : undefined,
      ].filter((part): part is string => Boolean(part))
      return details.length > 0 ? `\`${project}\` (${details.join('; ')})` : `\`${project}\``
    }
  }
  const repository = readString(readRecord(metadata, 'source_port'), 'source_repository')
  return repository ? `\`${repository}\`` : undefined
}

function readRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (!value) return undefined
  const nested = value[key]
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return undefined
  return nested as Readonly<Record<string, unknown>>
}

function readString(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const raw = value?.[key]
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined
}

function sortBySlug<T extends { readonly slug: string }>(manifests: readonly T[]): T[] {
  // Explicit codepoint order, not localeCompare: the rendered bytes must not
  // depend on the machine's locale.
  return [...manifests].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

function pathFor(paths: ReadonlyMap<string, string>, slug: string): string {
  const path = paths.get(slug)
  if (!path) throw new Error(`no manifest file found for slug: ${slug}`)
  return path
}

async function mapSlugsToPaths(
  repoRoot: string,
  dirPath: string,
  slugOf: (text: string) => string | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const filePath of await walkYamlFiles(dirPath)) {
    const slug = slugOf(await readFile(filePath, 'utf8'))
    if (slug) out.set(slug, relative(repoRoot, filePath).split(sep).join('/'))
  }
  return out
}

async function walkYamlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) out.push(full)
    }
  }
  out.sort()
  return out
}

async function countCommandMappings(repoRoot: string): Promise<number> {
  const path = resolve(repoRoot, COMMAND_MAP_SOURCE_PATH)
  try {
    await stat(path)
  } catch {
    throw new Error(`command map source not found: ${path}`)
  }
  const text = await readFile(path, 'utf8')
  return Array.from(text.matchAll(/^\s+- source_command: commands\/gsd\/.+$/gm)).length
}

const INTRO_SECTION = `# Waypoint Quest Catalog

<!-- GENERATED FILE — do not edit by hand. Regenerate with \`pnpm docs:catalog\`. -->

This catalog is generated from the Quest and Recipe manifests currently present on disk by
\`scripts/generate-quest-catalog.mjs\` (\`pnpm docs:catalog\`), which reads them through the same
\`loadQuestsFromDirectory\` / \`loadRecipesFromDirectory\` loaders the runtime uses. Every slug, name,
path, description, recipe list and side-effect declaration below is copied verbatim from a manifest.
\`pnpm docs:catalog:check\` (and \`src/__tests__/runner-docs.test.ts\`) fails when the committed doc
differs from a fresh generation.

It describes the bundled Waypoint Quest/Recipe library — the scaffold content Waypoint
ships. A host embedding the waypoint authors and installs its own catalog alongside (or
instead of) this one; the loaders treat every quest the same.`

const ATTRIBUTION_SECTION = `## Attribution and license

Waypoint itself is MIT-licensed under \`LICENSE\` (Copyright (c) 2026 Aaron Whaley).

The bundled source-derived Quest/Recipe artifacts are adaptations of the get-shit-done-cc project by Lex Christopherson:

- Upstream local snapshot checked for P7: \`/Users/aaronwhaley/Downloads/get-shit-done-main/\`
- Upstream license read for P7: \`MIT License\`
- Upstream copyright read for P7: \`Copyright (c) 2025 Lex Christopherson\`
- Preserved repo attribution: \`third_party/gsd/LICENSE\`
- Preserved repo notice: \`third_party/gsd/NOTICE.md\`

When redistributing Waypoint with the Waypoint source-derived Quest/Recipe library, preserve \`third_party/gsd/LICENSE\` and \`third_party/gsd/NOTICE.md\`.

Per-Quest source attribution below is read from each manifest's own \`metadata.source\` /
\`metadata.source_port\`.`

const PRIMARY_STARTER_BLURB = `### Primary starter Quests

Quests a user can choose when setting up a folder (\`metadata.runner.quest_family: primary_starter\`).`

const OTHER_QUESTS_BLURB = `### Other Quests

Quests that declare no \`metadata.runner.quest_family\` — demonstration and utility manifests.`

const DEFERRED_SECTION = `## Deferred / not implemented in this repo

- No standalone source CLI is implemented here.
- No first-class sub-Quest schema field exists yet; command mapping intent lives in metadata/docs.
- No built-in recipe executor is shipped in the standalone core package yet; hosts provide \`IRecipeRuntime\`.
- Namespace commands from the upstream source CLI (\`ns-*\`) remain deferred optional mappings, documented in \`docs/quests/runner-command-map.md\`.`
