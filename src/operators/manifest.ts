import { parse as yamlParse } from 'yaml'

export type OperatorManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly role: string
  readonly description?: string
  readonly instructions?: {
    readonly layers?: readonly OperatorInstructionLayer[]
  }
  readonly allowed_tools?: readonly OperatorToolRef[]
  readonly workspace?: Readonly<Record<string, unknown>>
  readonly handoffs?: readonly OperatorHandoffRef[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type OperatorInstructionLayer = {
  readonly kind: 'shared' | 'domain' | 'role' | 'task' | 'skill' | 'runbook'
  readonly ref: string
  readonly required?: boolean
}

export type OperatorToolRef = {
  readonly slug: string
  readonly command?: string
  readonly description?: string
}

export type OperatorHandoffRef = {
  readonly slug: string
  readonly to: string
  readonly gate?: string
}

export type OperatorManifestParseResult =
  | { readonly ok: true; readonly manifest: OperatorManifest }
  | { readonly ok: false; readonly error: OperatorManifestParseError }

export type OperatorManifestParseErrorCode =
  | 'invalid_input'
  | 'empty_input'
  | 'parse_error'
  | 'not_a_map'
  | 'missing_schema_version'
  | 'unsupported_schema_version'
  | 'missing_field'
  | 'invalid_field_type'
  | 'unsafe_command'

export type OperatorManifestParseError = {
  readonly code: OperatorManifestParseErrorCode
  readonly message: string
  readonly path?: string
}

const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1])
const INSTRUCTION_LAYER_KINDS = new Set(['shared', 'domain', 'role', 'task', 'skill', 'runbook'])
const SAFE_WAYPOINT_COMMAND_PREFIXES = [
  'waypoint operators ',
  'waypoint tools ',
  'waypoint handoffs ',
]
const UNSAFE_COMMAND_PATTERN = /[;&|`$\n\r]/

export function parseOperatorManifest(yamlText: unknown): OperatorManifestParseResult {
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
    return { ok: false, error: { code: 'parse_error', message: err instanceof Error ? err.message : 'yaml parse failed' } }
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

  for (const field of ['slug', 'name', 'role'] as const) {
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
    return { ok: false, error: { code: 'invalid_field_type', message: 'description must be a string', path: 'description' } }
  }

  const instructionsResult = parseInstructions(raw.instructions)
  if (instructionsResult.ok === false) return { ok: false, error: instructionsResult.error }

  const allowedToolsResult = parseAllowedTools(raw.allowed_tools)
  if (allowedToolsResult.ok === false) return { ok: false, error: allowedToolsResult.error }

  const workspaceResult = parseOptionalRecord(raw.workspace, 'workspace')
  if (workspaceResult.ok === false) return { ok: false, error: workspaceResult.error }

  const handoffsResult = parseHandoffs(raw.handoffs)
  if (handoffsResult.ok === false) return { ok: false, error: handoffsResult.error }

  const metadataResult = parseOptionalRecord(raw.metadata, 'metadata')
  if (metadataResult.ok === false) return { ok: false, error: metadataResult.error }

  return {
    ok: true,
    manifest: {
      schema_version: schemaVersion as 1,
      slug: raw.slug as string,
      name: raw.name as string,
      role: raw.role as string,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(instructionsResult.value ? { instructions: instructionsResult.value } : {}),
      ...(allowedToolsResult.value ? { allowed_tools: allowedToolsResult.value } : {}),
      ...(workspaceResult.value ? { workspace: workspaceResult.value } : {}),
      ...(handoffsResult.value ? { handoffs: handoffsResult.value } : {}),
      ...(metadataResult.value ? { metadata: metadataResult.value } : {}),
    },
  }
}

export function isOperatorManifest(value: unknown): value is OperatorManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return v.schema_version === 1 && typeof v.slug === 'string' && typeof v.name === 'string' && typeof v.role === 'string'
}

type ValueResult<T> =
  | { readonly ok: true; readonly value: T | undefined }
  | { readonly ok: false; readonly error: OperatorManifestParseError }

function parseInstructions(value: unknown): ValueResult<{ readonly layers?: readonly OperatorInstructionLayer[] }> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: { code: 'invalid_field_type', message: 'instructions must be a mapping', path: 'instructions' } }
  }
  const raw = value as Record<string, unknown>
  if (!('layers' in raw) || raw.layers === undefined) return { ok: true, value: {} }
  if (!Array.isArray(raw.layers)) {
    return { ok: false, error: { code: 'invalid_field_type', message: 'instructions.layers must be an array', path: 'instructions.layers' } }
  }
  const layers: OperatorInstructionLayer[] = []
  for (let i = 0; i < raw.layers.length; i++) {
    const layer = raw.layers[i]
    const path = `instructions.layers[${i}]`
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) {
      return { ok: false, error: { code: 'invalid_field_type', message: 'instruction layer must be a mapping', path } }
    }
    const lr = layer as Record<string, unknown>
    if (typeof lr.kind !== 'string' || !INSTRUCTION_LAYER_KINDS.has(lr.kind)) {
      return { ok: false, error: { code: 'invalid_field_type', message: 'instruction layer kind is invalid', path: `${path}.kind` } }
    }
    if (typeof lr.ref !== 'string' || lr.ref.trim() === '') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'instruction layer ref must be a non-empty string', path: `${path}.ref` } }
    }
    if ('required' in lr && lr.required !== undefined && typeof lr.required !== 'boolean') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'instruction layer required must be boolean', path: `${path}.required` } }
    }
    layers.push({ kind: lr.kind as OperatorInstructionLayer['kind'], ref: lr.ref, ...(typeof lr.required === 'boolean' ? { required: lr.required } : {}) })
  }
  return { ok: true, value: { layers } }
}

function parseAllowedTools(value: unknown): ValueResult<readonly OperatorToolRef[]> {
  if (value === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(value)) {
    return { ok: false, error: { code: 'invalid_field_type', message: 'allowed_tools must be an array', path: 'allowed_tools' } }
  }
  const tools: OperatorToolRef[] = []
  for (let i = 0; i < value.length; i++) {
    const tool = value[i]
    const path = `allowed_tools[${i}]`
    if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) {
      return { ok: false, error: { code: 'invalid_field_type', message: 'allowed tool must be a mapping', path } }
    }
    const tr = tool as Record<string, unknown>
    if (typeof tr.slug !== 'string' || tr.slug.trim() === '') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'allowed tool slug must be a non-empty string', path: `${path}.slug` } }
    }
    if ('command' in tr && tr.command !== undefined) {
      if (typeof tr.command !== 'string' || tr.command.trim() === '') {
        return { ok: false, error: { code: 'invalid_field_type', message: 'allowed tool command must be a non-empty string', path: `${path}.command` } }
      }
      const commandSafety = validateSafeWaypointCommand(tr.command)
      if (commandSafety.ok === false) {
        return { ok: false, error: { code: 'unsafe_command', message: commandSafety.message, path: `${path}.command` } }
      }
    }
    if ('description' in tr && tr.description !== undefined && typeof tr.description !== 'string') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'allowed tool description must be a string', path: `${path}.description` } }
    }
    tools.push({ slug: tr.slug, ...(typeof tr.command === 'string' ? { command: tr.command } : {}), ...(typeof tr.description === 'string' ? { description: tr.description } : {}) })
  }
  return { ok: true, value: tools }
}

function parseHandoffs(value: unknown): ValueResult<readonly OperatorHandoffRef[]> {
  if (value === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(value)) {
    return { ok: false, error: { code: 'invalid_field_type', message: 'handoffs must be an array', path: 'handoffs' } }
  }
  const handoffs: OperatorHandoffRef[] = []
  for (let i = 0; i < value.length; i++) {
    const handoff = value[i]
    const path = `handoffs[${i}]`
    if (handoff === null || typeof handoff !== 'object' || Array.isArray(handoff)) {
      return { ok: false, error: { code: 'invalid_field_type', message: 'handoff must be a mapping', path } }
    }
    const hr = handoff as Record<string, unknown>
    if (typeof hr.slug !== 'string' || hr.slug.trim() === '') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'handoff slug must be a non-empty string', path: `${path}.slug` } }
    }
    if (typeof hr.to !== 'string' || hr.to.trim() === '') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'handoff to must be a non-empty string', path: `${path}.to` } }
    }
    if ('gate' in hr && hr.gate !== undefined && typeof hr.gate !== 'string') {
      return { ok: false, error: { code: 'invalid_field_type', message: 'handoff gate must be a string', path: `${path}.gate` } }
    }
    handoffs.push({ slug: hr.slug, to: hr.to, ...(typeof hr.gate === 'string' ? { gate: hr.gate } : {}) })
  }
  return { ok: true, value: handoffs }
}

function parseOptionalRecord(value: unknown, path: string): ValueResult<Readonly<Record<string, unknown>>> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: { code: 'invalid_field_type', message: `${path} must be a mapping`, path } }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

function validateSafeWaypointCommand(command: string): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (UNSAFE_COMMAND_PATTERN.test(command)) {
    return { ok: false, message: 'command contains shell metacharacters' }
  }
  if (!SAFE_WAYPOINT_COMMAND_PREFIXES.some((prefix) => command === prefix.trimEnd() || command.startsWith(prefix))) {
    return { ok: false, message: 'command must use a recognized Waypoint-safe prefix' }
  }
  return { ok: true }
}
