import { parse as yamlParse } from 'yaml'

/**
 * QuestManifest — the structural shape of a Quest manifest (YAML file).
 *
 * A Quest is a named, reusable workflow template. It names a workflow YAML file
 * and optionally declares a lifecycle scaffold (workstream/milestone/phase/plan)
 * to generate when instantiated on a project, plus the recipes it composes.
 */
export type QuestManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly workflow: string
  readonly description?: string
  readonly recipes?: readonly string[]
  readonly handoff_manifests?: readonly string[]
  readonly scaffolds?: QuestScaffolds
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type QuestScaffolds = {
  readonly workstreams?: readonly QuestScaffoldWorkstream[]
}

export type QuestScaffoldWorkstream = {
  readonly key: string
  readonly name?: string
  readonly milestones?: readonly QuestScaffoldMilestone[]
}

export type QuestScaffoldMilestone = {
  readonly version_label: string
  readonly title?: string
  readonly phases?: readonly QuestScaffoldPhase[]
}

export type QuestScaffoldPhase = {
  readonly phase_key: string
  readonly phase_slug: string
  readonly lifecycle_phase?: string
  readonly plans?: readonly QuestScaffoldPlan[]
}

export type QuestScaffoldPlan = {
  readonly plan_ref: string
  readonly title?: string
  readonly wave?: number
}

export type QuestManifestParseResult =
  | { readonly ok: true; readonly manifest: QuestManifest }
  | { readonly ok: false; readonly error: QuestManifestParseError }

export type QuestManifestParseErrorCode =
  | 'invalid_input'
  | 'empty_input'
  | 'parse_error'
  | 'not_a_map'
  | 'missing_schema_version'
  | 'unsupported_schema_version'
  | 'missing_field'
  | 'invalid_field_type'

export type QuestManifestParseError = {
  readonly code: QuestManifestParseErrorCode
  readonly message: string
  readonly path?: string
}

const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1])

export function parseQuestManifest(yamlText: unknown): QuestManifestParseResult {
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

  for (const field of ['slug', 'name', 'workflow'] as const) {
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

  let recipes: readonly string[] | undefined
  if ('recipes' in raw && raw.recipes !== undefined) {
    if (!Array.isArray(raw.recipes)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'recipes must be an array', path: 'recipes' },
      }
    }
    for (let i = 0; i < raw.recipes.length; i++) {
      if (typeof raw.recipes[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'recipes entries must be strings',
            path: `recipes[${i}]`,
          },
        }
      }
    }
    recipes = raw.recipes as readonly string[]
  }

  let handoff_manifests: readonly string[] | undefined
  if ('handoff_manifests' in raw && raw.handoff_manifests !== undefined) {
    if (!Array.isArray(raw.handoff_manifests)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'handoff_manifests must be an array', path: 'handoff_manifests' },
      }
    }
    for (let i = 0; i < raw.handoff_manifests.length; i++) {
      if (typeof raw.handoff_manifests[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'handoff_manifests entries must be strings',
            path: `handoff_manifests[${i}]`,
          },
        }
      }
    }
    handoff_manifests = raw.handoff_manifests as readonly string[]
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

  let scaffolds: QuestScaffolds | undefined
  if ('scaffolds' in raw && raw.scaffolds !== undefined) {
    if (typeof raw.scaffolds !== 'object' || raw.scaffolds === null || Array.isArray(raw.scaffolds)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'scaffolds must be a mapping', path: 'scaffolds' },
      }
    }
    scaffolds = raw.scaffolds as QuestScaffolds
  }

  const manifest: QuestManifest = {
    schema_version: schemaVersion as 1,
    slug: raw.slug as string,
    name: raw.name as string,
    workflow: raw.workflow as string,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(recipes ? { recipes } : {}),
    ...(handoff_manifests ? { handoff_manifests } : {}),
    ...(scaffolds ? { scaffolds } : {}),
    ...(metadata ? { metadata } : {}),
  }

  return { ok: true, manifest }
}

/**
 * Quest availability (D5, 2026-08-24) — whether a Quest has ever been proven
 * end to end. A Quest that exists in the catalog but has never run is real
 * code with an unknown failure surface; several of them move money. Declaring
 * `metadata.runner.availability: not_yet_available` keeps it visible (and
 * editable) while refusing to start it, so it is proven deliberately rather
 * than discovered by a user one click away in the Console.
 */
export const QUEST_AVAILABILITY_VALUES = ['available', 'not_yet_available'] as const
export type QuestAvailability = (typeof QUEST_AVAILABILITY_VALUES)[number]

/**
 * Read `metadata.runner.availability`. Absent means available — the default
 * for every Quest that predates the field. Anything present but unrecognized
 * reads as `not_yet_available`: a status fallback defaults to the guarded
 * value, never to the reassuring one.
 */
export function questAvailability(metadata: unknown): QuestAvailability {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return 'available'
  const runner = (metadata as { runner?: unknown }).runner
  if (runner === null || typeof runner !== 'object' || Array.isArray(runner)) return 'available'
  const value = (runner as { availability?: unknown }).availability
  if (value === undefined) return 'available'
  return value === 'available' ? 'available' : 'not_yet_available'
}

/** True when this Quest may be started. */
export function questIsAvailable(metadata: unknown): boolean {
  return questAvailability(metadata) === 'available'
}

export function isQuestManifest(value: unknown): value is QuestManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.schema_version === 1 &&
    typeof v.slug === 'string' &&
    typeof v.name === 'string' &&
    typeof v.workflow === 'string'
  )
}
