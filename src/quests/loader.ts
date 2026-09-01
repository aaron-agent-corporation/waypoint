import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createQuestRegistry, type QuestRegistry } from './registry.ts'
import { parseQuestManifest, type QuestManifestParseError } from './manifest.ts'

export type LoadQuestsResult =
  | { readonly ok: true; readonly registry: QuestRegistry }
  | { readonly ok: false; readonly errors: readonly LoadQuestError[] }

export type LoadQuestErrorCode =
  | 'directory_not_found'
  | 'not_a_directory'
  | 'read_error'
  | 'parse_error'
  | 'slug_collision'

export type LoadQuestError = {
  readonly code: LoadQuestErrorCode
  readonly path: string
  readonly message: string
  readonly parseError?: QuestManifestParseError
}

/**
 * Recursively load every `.yaml` / `.yml` file under `dirPath` as a Quest
 * manifest and register it in a fresh registry.
 *
 * Collect-all semantics: any parse errors and slug collisions are ALL reported
 * in a single error array rather than failing on the first. Returns ok with
 * the populated registry only if every file parsed and registered cleanly.
 *
 * An empty directory is not an error — it returns ok with an empty registry.
 */
export async function loadQuestsFromDirectory(dirPath: string): Promise<LoadQuestsResult> {
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
  const registry = createQuestRegistry()
  const errors: LoadQuestError[] = []

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

    const parsed = parseQuestManifest(text)
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
