import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
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

export interface BundledWaypointCatalog {
  readonly root: string
  readonly questsDir: string
  readonly recipesDir: string
  readonly quests: CatalogRegistry<CatalogQuestManifest>
  readonly recipes: CatalogRegistry<CatalogRecipeManifest>
  readonly questEntries: readonly WaypointCatalogEntry<CatalogQuestManifest>[]
  readonly recipeEntries: readonly WaypointCatalogEntry<CatalogRecipeManifest>[]
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

export async function loadBundledWaypointCatalog(
  options: LoadBundledWaypointCatalogOptions = {},
): Promise<BundledWaypointCatalog> {
  const root = options.root ?? (await findBundledCatalogRoot())
  const questsDir = join(root, 'quests')
  const recipesDir = join(root, 'recipes')

  const questEntries = await loadQuestEntries(questsDir)
  const recipeEntries = await loadRecipeEntries(recipesDir)
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
    resolveQuestRecipes(questSlug) {
      const quest = quests.get(questSlug)
      const questEntry = questEntries.find((entry) => entry.slug === questSlug)
      if (!quest || !questEntry) {
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
          unresolved.push(slug)
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

async function isDirectory(path: string): Promise<boolean> {
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

async function loadQuestEntries(root: string): Promise<WaypointCatalogEntry<CatalogQuestManifest>[]> {
  const files = await walkYamlFiles(root)
  const entries: WaypointCatalogEntry<CatalogQuestManifest>[] = []
  for (const file of files) {
    const manifest = parseCatalogQuestManifest(await readFile(file, 'utf8'), file)
    entries.push({ slug: manifest.slug, manifest, path: file, relativePath: relative(root, file) })
  }
  return entries.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function loadRecipeEntries(root: string): Promise<WaypointCatalogEntry<CatalogRecipeManifest>[]> {
  const files = await walkYamlFiles(root)
  const entries: WaypointCatalogEntry<CatalogRecipeManifest>[] = []
  for (const file of files) {
    const manifest = parseCatalogRecipeManifest(await readFile(file, 'utf8'), file)
    entries.push({ slug: manifest.slug, manifest, path: file, relativePath: relative(root, file) })
  }
  return entries.sort((a, b) => a.slug.localeCompare(b.slug))
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

function parseCatalogQuestManifest(text: string, path: string): CatalogQuestManifest {
  const value = parseYaml(text) as Record<string, unknown> | null
  if (!value || typeof value !== 'object') throw new Error(`invalid Quest manifest: ${path}`)
  const schemaVersion = value.schema_version
  const slug = value.slug
  const name = value.name
  const workflow = value.workflow
  if (schemaVersion !== 1 || typeof slug !== 'string' || typeof name !== 'string' || typeof workflow !== 'string') {
    throw new Error(`invalid Quest manifest: ${path}`)
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

function parseCatalogRecipeManifest(text: string, path: string): CatalogRecipeManifest {
  const value = parseYaml(text) as Record<string, unknown> | null
  if (!value || typeof value !== 'object') throw new Error(`invalid Recipe manifest: ${path}`)
  const schemaVersion = value.schema_version
  const slug = value.slug
  const name = value.name
  if (schemaVersion !== 1 || typeof slug !== 'string' || typeof name !== 'string') {
    throw new Error(`invalid Recipe manifest: ${path}`)
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
