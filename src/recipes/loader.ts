import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createRecipeRegistry, type RecipeRegistry } from './registry.js'
import { parseRecipeManifest, type RecipeManifestParseError } from './manifest.js'

export type LoadRecipesResult =
  | { readonly ok: true; readonly registry: RecipeRegistry }
  | { readonly ok: false; readonly errors: readonly LoadRecipeError[] }

export type LoadRecipeErrorCode =
  | 'directory_not_found'
  | 'not_a_directory'
  | 'read_error'
  | 'parse_error'
  | 'slug_collision'

export type LoadRecipeError = {
  readonly code: LoadRecipeErrorCode
  readonly path: string
  readonly message: string
  readonly parseError?: RecipeManifestParseError
}

/**
 * Recursively load every `.yaml` / `.yml` file under `dirPath` as a Recipe
 * manifest. Same collect-all semantics as loadQuestsFromDirectory.
 */
export async function loadRecipesFromDirectory(dirPath: string): Promise<LoadRecipesResult> {
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
    return {
      ok: false,
      errors: [{ code: 'not_a_directory', path: dirPath, message: `not a directory: ${dirPath}` }],
    }
  }

  const files = await walkYamlFiles(dirPath)
  const registry = createRecipeRegistry()
  const errors: LoadRecipeError[] = []

  for (const filePath of files) {
    let text: string
    try {
      text = await readFile(filePath, 'utf8')
    } catch (err) {
      errors.push({
        code: 'read_error',
        path: relative(dirPath, filePath),
        message: err instanceof Error ? err.message : 'read failed',
      })
      continue
    }

    const parsed = parseRecipeManifest(text)
    if (!parsed.ok) {
      const parseError = parsed.error
      errors.push({
        code: 'parse_error',
        path: relative(dirPath, filePath),
        message: parseError.message,
        parseError,
      })
      continue
    }

    const addResult = registry.add(parsed.manifest)
    if (!addResult.ok) {
      const addError = addResult.error
      errors.push({
        code: addError.code === 'slug_collision' ? 'slug_collision' : 'parse_error',
        path: relative(dirPath, filePath),
        message: addError.message,
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, registry }
}

async function walkYamlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]
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
  out.sort()
  return out
}
