import { parse as yamlParse } from 'yaml'

/**
 * A handoff graph manifest defines explicit operator-to-operator (or
 * operator-to-human) handoff paths within a Waypoint workflow.
 *
 * Each handoff step declares a source operator (`from`), a target (`to`),
 * the event or condition that triggers the handoff (`trigger`), and
 * optionally a gate that must be resolved before the handoff can proceed.
 *
 * This is Waypoint-native: no external runtime, no arbitrary execution —
 * just structured, validated YAML that the CLI and runtime can reason about.
 */

export type HandoffManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly handoffs: readonly HandoffStep[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type HandoffStep = {
  readonly slug: string
  readonly from: string
  readonly to: string
  readonly trigger: string
  readonly gate?: string
  readonly required_artifacts?: readonly string[]
}

export type HandoffManifestParseResult =
  | { readonly ok: true; readonly manifest: HandoffManifest }
  | { readonly ok: false; readonly error: HandoffManifestParseError }

export type HandoffManifestParseErrorCode =
  | 'invalid_input'
  | 'empty_input'
  | 'parse_error'
  | 'not_a_map'
  | 'missing_schema_version'
  | 'unsupported_schema_version'
  | 'missing_field'
  | 'invalid_field_type'

export type HandoffManifestParseError = {
  readonly code: HandoffManifestParseErrorCode
  readonly message: string
  readonly path?: string
}

const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1])

export function parseHandoffManifest(yamlText: unknown): HandoffManifestParseResult {
  if (typeof yamlText !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'input must be a string' },
    }
  }
  if (yamlText.trim() === '') {
    return {
      ok: false,
      error: { code: 'empty_input', message: 'input is empty' },
    }
  }

  let parsed: unknown
  try {
    parsed = yamlParse(yamlText)
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'parse_error',
        message: err instanceof Error ? err.message : 'yaml parse failed',
      },
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: 'not_a_map', message: 'top-level must be a mapping' },
    }
  }

  const raw = parsed as Record<string, unknown>

  // schema_version
  if (!('schema_version' in raw)) {
    return {
      ok: false,
      error: {
        code: 'missing_schema_version',
        message: 'schema_version is required',
        path: 'schema_version',
      },
    }
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

  // slug
  const slugResult = parseRequiredString(raw, 'slug')
  if (slugResult.ok === false) return { ok: false, error: slugResult.error }

  // name
  const nameResult = parseRequiredString(raw, 'name')
  if (nameResult.ok === false) return { ok: false, error: nameResult.error }

  // description (optional)
  const description = parseOptionalString(raw, 'description')
  if (typeof description === 'string' && description.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'description must be a non-empty string if provided',
        path: 'description',
      },
    }
  }

  // handoffs — required, non-empty array
  const handoffsResult = parseHandoffs(raw.handoffs)
  if (handoffsResult.ok === false) return { ok: false, error: handoffsResult.error }

  // metadata (optional)
  const metadata = parseOptionalRecord(raw.metadata, 'metadata')
  if (metadata.ok === false) return { ok: false, error: metadata.error }

  return {
    ok: true,
    manifest: {
      schema_version: schemaVersion as 1,
      slug: slugResult.value as string,
      name: nameResult.value as string,
      ...(typeof description === 'string' ? { description } : {}),
      handoffs: handoffsResult.value,
      ...(metadata.value ? { metadata: metadata.value } : {}),
    },
  }
}

export function isHandoffManifest(value: unknown): value is HandoffManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.schema_version === 1 &&
    typeof v.slug === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.handoffs) &&
    v.handoffs.length > 0
  )
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: HandoffManifestParseError }

function parseRequiredString(raw: Record<string, unknown>, field: string): ParseResult<string> {
  if (!(field in raw)) {
    return {
      ok: false,
      error: { code: 'missing_field', message: `${field} is required`, path: field },
    }
  }
  if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: `${field} must be a non-empty string`,
        path: field,
      },
    }
  }
  return { ok: true, value: raw[field] as string }
}

function parseOptionalString(raw: Record<string, unknown>, field: string): string | undefined {
  if (!(field in raw)) return undefined
  if (raw[field] === undefined) return undefined
  if (typeof raw[field] !== 'string') return undefined
  return raw[field] as string
}

function parseHandoffs(value: unknown): ParseResult<readonly HandoffStep[]> {
  if (value === undefined) {
    return {
      ok: false,
      error: { code: 'missing_field', message: 'handoffs is required', path: 'handoffs' },
    }
  }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: 'handoffs must be an array', path: 'handoffs' },
    }
  }
  if (value.length === 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'handoffs must not be empty',
        path: 'handoffs',
      },
    }
  }

  const steps: HandoffStep[] = []
  for (let i = 0; i < value.length; i++) {
    const stepResult = parseHandoffStep(value[i], i)
    if (stepResult.ok === false) return stepResult
    steps.push(stepResult.value as HandoffStep)
  }

  return { ok: true, value: steps }
}

function parseHandoffStep(
  raw: unknown,
  index: number,
): ParseResult<HandoffStep> {
  const path = `handoffs[${index}]`

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: 'handoff must be a mapping', path },
    }
  }

  const r = raw as Record<string, unknown>

  // slug — required
  if (!('slug' in r) || typeof r.slug !== 'string' || r.slug.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'handoff slug must be a non-empty string',
        path: `${path}.slug`,
      },
    }
  }

  // from — required
  if (!('from' in r) || typeof r.from !== 'string' || r.from.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'handoff from must be a non-empty string',
        path: `${path}.from`,
      },
    }
  }

  // to — required
  if (!('to' in r) || typeof r.to !== 'string' || r.to.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'handoff to must be a non-empty string',
        path: `${path}.to`,
      },
    }
  }

  // trigger — required
  if (!('trigger' in r) || typeof r.trigger !== 'string' || r.trigger.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'invalid_field_type',
        message: 'handoff trigger must be a non-empty string',
        path: `${path}.trigger`,
      },
    }
  }

  // gate — optional
  let gate: string | undefined
  if ('gate' in r && r.gate !== undefined) {
    if (typeof r.gate !== 'string') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'handoff gate must be a string',
          path: `${path}.gate`,
        },
      }
    }
    gate = r.gate
  }

  // required_artifacts — optional
  let requiredArtifacts: readonly string[] | undefined
  if ('required_artifacts' in r && r.required_artifacts !== undefined) {
    if (!Array.isArray(r.required_artifacts)) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'handoff required_artifacts must be an array',
          path: `${path}.required_artifacts`,
        },
      }
    }
    for (let j = 0; j < r.required_artifacts.length; j++) {
      if (typeof r.required_artifacts[j] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'handoff required_artifacts element must be a string',
            path: `${path}.required_artifacts[${j}]`,
          },
        }
      }
    }
    requiredArtifacts = r.required_artifacts as readonly string[]
  }

  return {
    ok: true,
    value: {
      slug: r.slug as string,
      from: r.from as string,
      to: r.to as string,
      trigger: r.trigger as string,
      ...(gate !== undefined ? { gate } : {}),
      ...(requiredArtifacts !== undefined ? { required_artifacts: requiredArtifacts } : {}),
    },
  }
}

function parseOptionalRecord(
  value: unknown,
  fieldName: string,
): { ok: true; value?: Readonly<Record<string, unknown>> } | { ok: false; error: HandoffManifestParseError } {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: `${fieldName} must be a mapping`, path: fieldName },
    }
  }
  return { ok: true, value: value as Record<string, unknown> }
}