import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseHandoffManifest,
  type HandoffManifest,
  type HandoffManifestParseResult,
  type HandoffManifestParseError,
} from './manifest.js'
import { createHandoffManifestRegistry, type HandoffManifestRegistry } from './registry.js'

export type LoadHandoffManifestsResult =
  | {
      readonly ok: true
      readonly manifests: readonly HandoffManifest[]
      readonly entries: readonly HandoffManifestEntry[]
      readonly registry: HandoffManifestRegistry
    }
  | { readonly ok: false; readonly errors: readonly LoadHandoffError[] }

export type HandoffManifestEntry = {
  readonly slug: string
  readonly manifest: HandoffManifest
  readonly path: string
  readonly relativePath: string
}

export type LoadHandoffErrorCode =
  | 'directory_not_found'
  | 'not_a_directory'
  | 'read_error'
  | 'parse_error'
  | 'slug_collision'

export type LoadHandoffError = {
  readonly code: LoadHandoffErrorCode
  readonly path: string
  readonly message: string
  readonly parseError?: HandoffManifestParseError
}

/**
 * Load handoff manifest YAML files from a directory.
 * Returns all successfully parsed manifests, or all errors if any occur.
 */
export async function loadHandoffManifestsFromDirectory(
  dirPath: string,
): Promise<LoadHandoffManifestsResult> {
  let info
  try {
    info = await stat(dirPath)
  } catch {
    // Directory not found is not a fatal error — simply return empty
    return {
      ok: true,
      manifests: [],
      entries: [],
      registry: createHandoffManifestRegistry(),
    }
  }

  if (!info.isDirectory()) {
    return {
      ok: false,
      errors: [
        {
          code: 'not_a_directory',
          path: dirPath,
          message: `not a directory: ${dirPath}`,
        },
      ],
    }
  }

  const files = await walkYamlFiles(dirPath)
  const entries: HandoffManifestEntry[] = []
  const errors: LoadHandoffError[] = []
  const seen = new Map<string, string>()

  for (const filePath of files) {
    const relativePath = relative(dirPath, filePath)
    let text: string
    try {
      text = await readFile(filePath, 'utf8')
    } catch (err) {
      errors.push({
        code: 'read_error',
        path: relativePath,
        message: err instanceof Error ? err.message : 'read failed',
      })
      continue
    }

    const parsed = parseHandoffManifest(text)
    if (parsed.ok === false) {
      errors.push({
        code: 'parse_error',
        path: relativePath,
        message: parsed.error.message,
        parseError: parsed.error,
      })
      continue
    }

    const firstPath = seen.get(parsed.manifest.slug)
    if (firstPath) {
      errors.push({
        code: 'slug_collision',
        path: relativePath,
        message: `handoff manifest slug collision: ${parsed.manifest.slug} already loaded from ${firstPath}`,
      })
      continue
    }
    seen.set(parsed.manifest.slug, relativePath)
    entries.push({
      slug: parsed.manifest.slug,
      manifest: parsed.manifest,
      path: filePath,
      relativePath,
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  const registry = createHandoffManifestRegistry()
  for (const entry of entries) {
    registry.add(entry.manifest)
  }
  return {
    ok: true,
    manifests: entries.map((entry) => entry.manifest),
    entries,
    registry,
  }
}

/**
 * Find the bundled handoffs root by walking up from this module's location.
 */
export async function loadBundledHandoffManifests(): Promise<LoadHandoffManifestsResult> {
  const root = await findBundledHandoffsRoot()
  return loadHandoffManifestsFromDirectory(join(root, 'handoffs'))
}

async function findBundledHandoffsRoot(): Promise<string> {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      (await isDirectory(join(current, 'handoffs', 'firmvault'))) &&
      (await isDirectory(join(current, 'quests'))) &&
      (await isDirectory(join(current, 'recipes')))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('could not locate bundled Waypoint handoffs root')
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