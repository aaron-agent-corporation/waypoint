import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseOperatorManifest, type OperatorManifest, type OperatorManifestParseError } from './manifest.ts'

export type LoadOperatorsResult =
  | { readonly ok: true; readonly operators: readonly OperatorManifest[]; readonly entries: readonly OperatorManifestEntry[] }
  | { readonly ok: false; readonly errors: readonly LoadOperatorError[] }

export type OperatorManifestEntry = {
  readonly slug: string
  readonly manifest: OperatorManifest
  readonly path: string
  readonly relativePath: string
}

export type LoadOperatorErrorCode =
  | 'directory_not_found'
  | 'not_a_directory'
  | 'read_error'
  | 'parse_error'
  | 'slug_collision'

export type LoadOperatorError = {
  readonly code: LoadOperatorErrorCode
  readonly path: string
  readonly message: string
  readonly parseError?: OperatorManifestParseError
}

export async function loadOperatorsFromDirectory(dirPath: string): Promise<LoadOperatorsResult> {
  let info
  try {
    info = await stat(dirPath)
  } catch {
    return {
      ok: false,
      errors: [{ code: 'directory_not_found', path: dirPath, message: `directory not found: ${dirPath}` }],
    }
  }
  if (!info.isDirectory()) {
    return { ok: false, errors: [{ code: 'not_a_directory', path: dirPath, message: `not a directory: ${dirPath}` }] }
  }

  const files = await walkYamlFiles(dirPath)
  const entries: OperatorManifestEntry[] = []
  const errors: LoadOperatorError[] = []
  const seen = new Map<string, string>()

  for (const filePath of files) {
    const relativePath = relative(dirPath, filePath)
    let text: string
    try {
      text = await readFile(filePath, 'utf8')
    } catch (err) {
      errors.push({ code: 'read_error', path: relativePath, message: err instanceof Error ? err.message : 'read failed' })
      continue
    }

    const parsed = parseOperatorManifest(text)
    if (parsed.ok === false) {
      errors.push({ code: 'parse_error', path: relativePath, message: parsed.error.message, parseError: parsed.error })
      continue
    }

    const firstPath = seen.get(parsed.manifest.slug)
    if (firstPath) {
      errors.push({
        code: 'slug_collision',
        path: relativePath,
        message: `operator slug collision: ${parsed.manifest.slug} already loaded from ${firstPath}`,
      })
      continue
    }
    seen.set(parsed.manifest.slug, relativePath)
    entries.push({ slug: parsed.manifest.slug, manifest: parsed.manifest, path: filePath, relativePath })
  }

  if (errors.length > 0) return { ok: false, errors }
  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  return { ok: true, operators: entries.map((entry) => entry.manifest), entries }
}

export async function loadBundledOperators(): Promise<LoadOperatorsResult> {
  const root = await findBundledOperatorsRoot()
  return loadOperatorsFromDirectory(join(root, 'operators'))
}

async function findBundledOperatorsRoot(): Promise<string> {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    // A CATALOG root, not a source module dir: `src/quests` and `src/recipes`
    // are TypeScript modules; the catalog's quests dir holds YAML manifests.
    if (
      (await isDirectory(join(current, 'recipes'))) &&
      (await directoryHasYaml(join(current, 'quests')))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('could not locate bundled operator root')
}

async function directoryHasYaml(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).some((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
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
