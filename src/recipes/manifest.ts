import { parse as yamlParse } from 'yaml'

/**
 * RecipeManifest — the structural shape of a Recipe manifest (YAML file).
 *
 * A Recipe is a named, reusable agent definition. It captures a prompt,
 * runtime hints (model, temperature, tokens), an allowed tool list, and
 * an optional set of subagent references. Recipes are composed by Quests.
 */
export type RecipeManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly prompt: string
  readonly description?: string
  readonly runtime?: RecipeRuntimeHints
  readonly tools?: readonly string[]
  readonly subagents?: readonly string[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type RecipeRuntimeHints = {
  readonly model?: string
  readonly temperature?: number
  readonly max_tokens?: number
}

export type RecipeManifestParseResult =
  | { readonly ok: true; readonly manifest: RecipeManifest }
  | { readonly ok: false; readonly error: RecipeManifestParseError }

export type RecipeManifestParseErrorCode =
  | 'invalid_input'
  | 'empty_input'
  | 'parse_error'
  | 'not_a_map'
  | 'missing_schema_version'
  | 'unsupported_schema_version'
  | 'missing_field'
  | 'invalid_field_type'

export type RecipeManifestParseError = {
  readonly code: RecipeManifestParseErrorCode
  readonly message: string
  readonly path?: string
}

const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1])

export function parseRecipeManifest(yamlText: unknown): RecipeManifestParseResult {
  if (typeof yamlText !== 'string') {
    return { ok: false, error: { code: 'invalid_input', message: 'input must be a string' } }
  }
  if (yamlText.trim() === '') {
    return { ok: false, error: { code: 'empty_input', message: 'input is empty' } }
  }

  let parsed: unknown
  try {
    parsed = yamlParse(yamlText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'yaml parse failed'
    return { ok: false, error: { code: 'parse_error', message: msg } }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { code: 'not_a_map', message: 'top-level must be a mapping' } }
  }

  const raw = parsed as Record<string, unknown>

  if (!('schema_version' in raw)) {
    return { ok: false, error: { code: 'missing_schema_version', message: 'schema_version is required' } }
  }
  const schemaVersion = raw.schema_version
  if (typeof schemaVersion !== 'number' || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return {
      ok: false,
      error: {
        code: 'unsupported_schema_version',
        message: `schema_version must be one of: ${Array.from(SUPPORTED_SCHEMA_VERSIONS).join(', ')}`,
      },
    }
  }

  for (const field of ['slug', 'name', 'prompt'] as const) {
    if (!(field in raw)) {
      return { ok: false, error: { code: 'missing_field', message: `${field} is required`, path: field } }
    }
    if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: `${field} must be a non-empty string`, path: field },
      }
    }
  }

  if ('description' in raw && raw.description !== undefined && typeof raw.description !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: 'description must be a string', path: 'description' },
    }
  }

  let runtime: RecipeRuntimeHints | undefined
  if ('runtime' in raw && raw.runtime !== undefined) {
    if (typeof raw.runtime !== 'object' || raw.runtime === null || Array.isArray(raw.runtime)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'runtime must be a mapping', path: 'runtime' },
      }
    }
    const rr = raw.runtime as Record<string, unknown>
    if ('model' in rr && rr.model !== undefined && typeof rr.model !== 'string') {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'runtime.model must be a string', path: 'runtime.model' },
      }
    }
    if ('temperature' in rr && rr.temperature !== undefined && typeof rr.temperature !== 'number') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.temperature must be a number',
          path: 'runtime.temperature',
        },
      }
    }
    if ('max_tokens' in rr && rr.max_tokens !== undefined && typeof rr.max_tokens !== 'number') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.max_tokens must be a number',
          path: 'runtime.max_tokens',
        },
      }
    }
    runtime = {
      ...(typeof rr.model === 'string' ? { model: rr.model } : {}),
      ...(typeof rr.temperature === 'number' ? { temperature: rr.temperature } : {}),
      ...(typeof rr.max_tokens === 'number' ? { max_tokens: rr.max_tokens } : {}),
    }
  }

  let tools: readonly string[] | undefined
  if ('tools' in raw && raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'tools must be an array', path: 'tools' },
      }
    }
    for (let i = 0; i < raw.tools.length; i++) {
      if (typeof raw.tools[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'tools entries must be strings',
            path: `tools[${i}]`,
          },
        }
      }
    }
    tools = raw.tools as readonly string[]
  }

  let subagents: readonly string[] | undefined
  if ('subagents' in raw && raw.subagents !== undefined) {
    if (!Array.isArray(raw.subagents)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'subagents must be an array', path: 'subagents' },
      }
    }
    for (let i = 0; i < raw.subagents.length; i++) {
      if (typeof raw.subagents[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'subagents entries must be strings',
            path: `subagents[${i}]`,
          },
        }
      }
    }
    subagents = raw.subagents as readonly string[]
  }

  let metadata: Record<string, unknown> | undefined
  if ('metadata' in raw && raw.metadata !== undefined) {
    if (typeof raw.metadata !== 'object' || raw.metadata === null || Array.isArray(raw.metadata)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'metadata must be a mapping', path: 'metadata' },
      }
    }
    metadata = raw.metadata as Record<string, unknown>
  }

  const manifest: RecipeManifest = {
    schema_version: schemaVersion as 1,
    slug: raw.slug as string,
    name: raw.name as string,
    prompt: raw.prompt as string,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(runtime && Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(tools ? { tools } : {}),
    ...(subagents ? { subagents } : {}),
    ...(metadata ? { metadata } : {}),
  }

  return { ok: true, manifest }
}

export function isRecipeManifest(value: unknown): value is RecipeManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.schema_version === 1 &&
    typeof v.slug === 'string' &&
    typeof v.name === 'string' &&
    typeof v.prompt === 'string'
  )
}
