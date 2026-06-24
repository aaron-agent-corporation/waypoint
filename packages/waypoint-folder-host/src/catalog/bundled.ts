import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

export interface CatalogQuestManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly workflow: string
  readonly recipes?: readonly string[]
  readonly handoff_manifests?: readonly string[]
  readonly scaffolds?: unknown
  readonly metadata?: unknown
}

export interface CatalogRecipeManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly runtime?: unknown
  readonly tools?: readonly string[]
  readonly metadata?: unknown
}

export interface CatalogRegistry<TManifest extends { readonly slug: string }> {
  has(slug: string): boolean
  get(slug: string): TManifest | undefined
  list(): readonly TManifest[]
  readonly size: number
}

export interface WaypointCatalogEntry<TManifest> {
  readonly slug: string
  readonly manifest: TManifest
  readonly path: string
  readonly relativePath: string
}

/**
 * A catalog file that failed to parse. Collected rather than thrown so a single
 * malformed authored manifest can no longer break resolution/discovery of every
 * other entry. `slug` is best-effort (leniently read) and may be absent.
 */
export interface CatalogEntryError {
  readonly path: string
  readonly relativePath: string
  readonly slug?: string
  readonly message: string
}

export interface LoadEntriesResult<TManifest> {
  readonly entries: WaypointCatalogEntry<TManifest>[]
  readonly errors: CatalogEntryError[]
}

export interface LoadEntriesOptions {
  /**
   * Throw on the first collected parse error instead of returning it as data.
   * Used by the curated, immutable bundled catalog where a malformed manifest is
   * a packaging defect that must fail loud at load. Workspace loading omits it.
   */
  readonly strict?: boolean
}

/** Render a parse error as a one-line skip-and-warn message for listing surfaces. */
export function formatCatalogEntryWarning(error: CatalogEntryError): string {
  return `skipped malformed manifest ${error.relativePath}: ${error.message}`
}

/**
 * Find the parse error for a requested slug, for MESSAGE scoping only (it never
 * decides what executes — tombstoning lives in the workspace overlay and keys on
 * exact relativePath). Prefer the leniently-read slug; fall back to the file
 * basename so a brand-new authored file too malformed to yield a slug still gets
 * a parse-specific message instead of degrading to "unknown". A best-effort
 * basename mismatch here is harmless: it only changes wording, never resolution.
 */
function findEntryError(errors: readonly CatalogEntryError[], slug: string): CatalogEntryError | undefined {
  return (
    errors.find((error) => error.slug === slug) ??
    errors.find((error) => basename(error.relativePath).replace(/\.ya?ml$/, '') === slug)
  )
}

export interface BundledWaypointCatalog {
  readonly root: string
  readonly questsDir: string
  readonly recipesDir: string
  readonly quests: CatalogRegistry<CatalogQuestManifest>
  readonly recipes: CatalogRegistry<CatalogRecipeManifest>
  readonly questEntries: readonly WaypointCatalogEntry<CatalogQuestManifest>[]
  readonly recipeEntries: readonly WaypointCatalogEntry<CatalogRecipeManifest>[]
  readonly questErrors: readonly CatalogEntryError[]
  readonly recipeErrors: readonly CatalogEntryError[]
  resolveQuestRecipes(questSlug: string): ResolveCatalogQuestRecipesResult
}

export type ResolveCatalogQuestRecipesResult =
  | {
      readonly ok: true
      readonly quest: CatalogQuestManifest
      readonly questEntry: WaypointCatalogEntry<CatalogQuestManifest>
      readonly recipes: readonly CatalogRecipeManifest[]
      readonly recipeEntries: readonly WaypointCatalogEntry<CatalogRecipeManifest>[]
    }
  | { readonly ok: false; readonly message: string }

export interface LoadBundledWaypointCatalogOptions {
  readonly root?: string
}

/**
 * Memoized default load. The bundled catalog is curated and immutable per process,
 * and the autopilot route runner resolves it once per recipe via the workspace
 * overlay — so re-walking + re-parsing it every call is pure waste. An explicit
 * `root` (tests/fixtures) always loads fresh and is never cached.
 */
let bundledCatalogPromise: Promise<BundledWaypointCatalog> | undefined

export function loadBundledWaypointCatalog(
  options: LoadBundledWaypointCatalogOptions = {},
): Promise<BundledWaypointCatalog> {
  if (options.root !== undefined) return loadBundledCatalogUncached(options.root)
  if (!bundledCatalogPromise) {
    const promise = loadBundledCatalogUncached(undefined)
    bundledCatalogPromise = promise
    // Never cache a failed load (e.g. a transient FS error) — let the next call retry.
    promise.catch(() => {
      if (bundledCatalogPromise === promise) bundledCatalogPromise = undefined
    })
  }
  return bundledCatalogPromise
}

/** Test-only: drop the memoized bundled catalog so a fixture change is re-read. */
export function clearBundledWaypointCatalogCache(): void {
  bundledCatalogPromise = undefined
}

async function loadBundledCatalogUncached(rootOption: string | undefined): Promise<BundledWaypointCatalog> {
  const root = rootOption ?? (await findBundledCatalogRoot())
  const questsDir = join(root, 'quests')
  const recipesDir = join(root, 'recipes')

  // strict: the bundle is curated and immutable — a malformed manifest is a build
  // defect and must fail loud at load, not degrade to a skip-and-warn (P2-1).
  const { entries: questEntries, errors: questErrors } = await loadQuestEntries(questsDir, { strict: true })
  const { entries: recipeEntries, errors: recipeErrors } = await loadRecipeEntries(recipesDir, { strict: true })

  return buildWaypointCatalog({ root, questsDir, recipesDir, questEntries, recipeEntries, questErrors, recipeErrors })
}

/**
 * Build a BundledWaypointCatalog value from already-loaded entries. Shared by
 * the bundled loader and the workspace-overlay loader so resolveQuestRecipes
 * lives in exactly one place.
 */
export function buildWaypointCatalog(params: {
  readonly root: string
  readonly questsDir: string
  readonly recipesDir: string
  readonly questEntries: readonly WaypointCatalogEntry<CatalogQuestManifest>[]
  readonly recipeEntries: readonly WaypointCatalogEntry<CatalogRecipeManifest>[]
  readonly questErrors?: readonly CatalogEntryError[]
  readonly recipeErrors?: readonly CatalogEntryError[]
}): BundledWaypointCatalog {
  const { root, questsDir, recipesDir, questEntries, recipeEntries } = params
  const questErrors = params.questErrors ?? []
  const recipeErrors = params.recipeErrors ?? []
  const quests = createCatalogRegistry(questEntries.map((entry) => entry.manifest))
  const recipes = createCatalogRegistry(recipeEntries.map((entry) => entry.manifest))

  return {
    root,
    questsDir,
    recipesDir,
    quests,
    recipes,
    questEntries,
    recipeEntries,
    questErrors,
    recipeErrors,
    resolveQuestRecipes(questSlug) {
      const quest = quests.get(questSlug)
      const questEntry = questEntries.find((entry) => entry.slug === questSlug)
      if (!quest || !questEntry) {
        // Fail loud, but only for the requested quest: if its own file failed to
        // parse, say so precisely; otherwise it is genuinely unknown.
        const errored = findEntryError(questErrors, questSlug)
        if (errored) {
          return { ok: false, message: `Quest '${questSlug}' failed to parse: ${errored.relativePath}: ${errored.message}` }
        }
        return { ok: false, message: `unknown Quest: ${questSlug}` }
      }

      const recipeSlugs = quest.recipes ?? []
      const resolvedRecipes: CatalogRecipeManifest[] = []
      const resolvedEntries: WaypointCatalogEntry<CatalogRecipeManifest>[] = []
      const unresolved: string[] = []

      for (const slug of recipeSlugs) {
        const recipe = recipes.get(slug)
        const entry = recipeEntries.find((candidate) => candidate.slug === slug)
        if (!recipe || !entry) {
          // A winner that failed to parse surfaces as unresolved (still fail-loud
          // for this quest) — annotate it so the cause is the parse error, not a
          // missing file.
          const errored = findEntryError(recipeErrors, slug)
          unresolved.push(errored ? `${slug} (failed to parse: ${errored.relativePath}: ${errored.message})` : slug)
        } else {
          resolvedRecipes.push(recipe)
          resolvedEntries.push(entry)
        }
      }

      if (unresolved.length > 0) {
        return { ok: false, message: `unresolved recipe slug(s): ${unresolved.join(', ')}` }
      }

      return {
        ok: true,
        quest,
        questEntry,
        recipes: resolvedRecipes,
        recipeEntries: resolvedEntries,
      }
    },
  }
}

async function findBundledCatalogRoot(): Promise<string> {
  let current = dirname(fileURLToPath(import.meta.url))

  for (let depth = 0; depth < 10; depth += 1) {
    if (await hasCatalogYamlFiles(current)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  current = dirname(fileURLToPath(import.meta.resolve('@waypoint/core')))
  for (let depth = 0; depth < 10; depth += 1) {
    if (await hasCatalogYamlFiles(current)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new Error('could not locate bundled Waypoint catalog root')
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function hasCatalogYamlFiles(path: string): Promise<boolean> {
  const questsDir = join(path, 'quests')
  const recipesDir = join(path, 'recipes')
  if (!(await isDirectory(questsDir)) || !(await isDirectory(recipesDir))) return false
  return (await hasYamlFile(questsDir)) && (await hasYamlFile(recipesDir))
}

async function hasYamlFile(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.some((entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')))
  } catch {
    return false
  }
}

export function loadQuestEntries(
  root: string,
  options: LoadEntriesOptions = {},
): Promise<LoadEntriesResult<CatalogQuestManifest>> {
  return loadEntries(root, parseCatalogQuestManifest, 'Quest', options)
}

export function loadRecipeEntries(
  root: string,
  options: LoadEntriesOptions = {},
): Promise<LoadEntriesResult<CatalogRecipeManifest>> {
  return loadEntries(root, parseCatalogRecipeManifest, 'Recipe', options)
}

async function loadEntries<TManifest extends { readonly slug: string }>(
  root: string,
  parse: (text: string) => TManifest,
  kind: 'Quest' | 'Recipe',
  options: LoadEntriesOptions,
): Promise<LoadEntriesResult<TManifest>> {
  const files = await walkYamlFiles(root)
  const entries: WaypointCatalogEntry<TManifest>[] = []
  const errors: CatalogEntryError[] = []
  for (const file of files) {
    const relativePath = relative(root, file)
    let text: string
    try {
      // readFile is inside the try so an IO race (a half-saved file renamed/deleted
      // mid-load) is collected as data rather than aborting the whole load (P3-1).
      text = await readFile(file, 'utf8')
    } catch (err) {
      errors.push({ path: file, relativePath, message: err instanceof Error ? err.message : String(err) })
      continue
    }
    try {
      const manifest = parse(text)
      entries.push({ slug: manifest.slug, manifest, path: file, relativePath })
    } catch (err) {
      errors.push({ path: file, relativePath, slug: readSlugLenient(text), message: err instanceof Error ? err.message : String(err) })
    }
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  if (options.strict && errors.length > 0) {
    // The curated, immutable bundle must fail loud: a malformed manifest there is a
    // packaging defect, not an authoring mistake. Workspace loading stays tolerant.
    throw new Error(`invalid ${kind} manifest: ${errors[0].relativePath}: ${errors[0].message}`)
  }
  return { entries, errors }
}

function readSlugLenient(text: string): string | undefined {
  try {
    const value = parseYaml(text) as Record<string, unknown> | null
    const slug = value?.slug
    return typeof slug === 'string' ? slug : undefined
  } catch {
    return undefined
  }
}

async function walkYamlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

function parseCatalogQuestManifest(text: string): CatalogQuestManifest {
  const value = parseYaml(text) as Record<string, unknown> | null
  // The path is owned by the caller (CatalogEntryError.relativePath); keep the
  // message path-free so warnings don't leak the absolute host filesystem layout.
  if (!value || typeof value !== 'object') throw new Error('invalid Quest manifest')
  const schemaVersion = value.schema_version
  const slug = value.slug
  const name = value.name
  const workflow = value.workflow
  if (schemaVersion !== 1 || typeof slug !== 'string' || typeof name !== 'string' || typeof workflow !== 'string') {
    throw new Error('invalid Quest manifest')
  }
  const recipes = Array.isArray(value.recipes) ? value.recipes.filter((item): item is string => typeof item === 'string') : undefined
  const handoffManifests = Array.isArray(value.handoff_manifests)
    ? value.handoff_manifests.filter((item): item is string => typeof item === 'string')
    : undefined
  return {
    schema_version: 1,
    slug,
    name,
    workflow,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(recipes ? { recipes } : {}),
    ...(handoffManifests ? { handoff_manifests: handoffManifests } : {}),
    ...(value.scaffolds !== undefined ? { scaffolds: value.scaffolds } : {}),
    ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
  }
}

function parseCatalogRecipeManifest(text: string): CatalogRecipeManifest {
  const value = parseYaml(text) as Record<string, unknown> | null
  if (!value || typeof value !== 'object') throw new Error('invalid Recipe manifest')
  const schemaVersion = value.schema_version
  const slug = value.slug
  const name = value.name
  if (schemaVersion !== 1 || typeof slug !== 'string' || typeof name !== 'string') {
    throw new Error('invalid Recipe manifest')
  }
  const tools = Array.isArray(value.tools) ? value.tools.filter((item): item is string => typeof item === 'string') : undefined
  return {
    schema_version: 1,
    slug,
    name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(value.runtime !== undefined ? { runtime: value.runtime } : {}),
    ...(tools ? { tools } : {}),
    ...(value.metadata !== undefined ? { metadata: value.metadata } : {}),
  }
}

function createCatalogRegistry<TManifest extends { readonly slug: string }>(
  manifests: readonly TManifest[],
): CatalogRegistry<TManifest> {
  const items = new Map(manifests.map((manifest) => [manifest.slug, manifest]))
  return {
    has(slug) {
      return items.has(slug)
    },
    get(slug) {
      return items.get(slug)
    },
    list() {
      return Array.from(items.values()).sort((a, b) => a.slug.localeCompare(b.slug))
    },
    get size() {
      return items.size
    },
  }
}
