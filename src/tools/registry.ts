import { loadBundledOperators } from '../operators/loader'
import type { OperatorManifest } from '../operators/manifest'

export type WaypointToolSideEffectClass = 'read_only' | 'local_state_mutation' | 'local_file_copy' | 'external_handoff_metadata'

export type WaypointToolInput = {
  readonly name: string
  readonly required: boolean
  readonly description: string
  readonly repeatable?: boolean
}

export type WaypointToolDefinition = {
  readonly slug: string
  readonly command: string
  readonly description: string
  readonly inputs: readonly WaypointToolInput[]
  readonly evidence_behavior: string
  readonly side_effect_class: WaypointToolSideEffectClass
  readonly can_affect_legal_landmarks: boolean
  readonly safety_notes: readonly string[]
  readonly examples: readonly string[]
}

export type ListWaypointToolsResult =
  | { readonly ok: true; readonly operator_slug: string; readonly tools: readonly WaypointToolDefinition[] }
  | { readonly ok: false; readonly code: 'load_error' | 'unknown_operator'; readonly error: string }

export type ExplainWaypointToolResult =
  | { readonly ok: true; readonly tool: WaypointToolDefinition }
  | { readonly ok: false; readonly code: 'unknown_tool'; readonly error: string }

const TOOL_DEFINITIONS: readonly WaypointToolDefinition[] = [
  {
    slug: 'firmvault.guidance',
    command: 'waypoint firmvault guidance --json',
    description: 'Inspect current case stage, landmark progress, and recommended next actions.',
    inputs: [],
    evidence_behavior: 'read-only; does not require or create evidence',
    side_effect_class: 'read_only',
    can_affect_legal_landmarks: false,
    safety_notes: ['Reads explicit .waypoint/firmvault state and projected landmarks only.'],
    examples: ['waypoint firmvault guidance --json'],
  },
  {
    slug: 'firmvault.adopt.preview',
    command: 'waypoint firmvault adopt preview --json',
    description: 'Preview safe adoption proposals for an existing legacy case folder.',
    inputs: [],
    evidence_behavior: 'read-only preview; proposed evidence paths are not applied',
    side_effect_class: 'read_only',
    can_affect_legal_landmarks: false,
    safety_notes: ['Does not mutate legacy FirmVault folders or Waypoint state.'],
    examples: ['waypoint firmvault adopt preview --json'],
  },
  {
    slug: 'firmvault.adopt.init_safe',
    command: 'waypoint firmvault adopt init --apply-safe --json',
    description: 'Initialize Waypoint state from safe evidence-backed adoption proposals.',
    inputs: [],
    evidence_behavior: 'uses validated local evidence discovered during adoption preview',
    side_effect_class: 'local_state_mutation',
    can_affect_legal_landmarks: true,
    safety_notes: ['Writes only local .waypoint/firmvault state.', 'Does not mutate the legacy source case folder.'],
    examples: ['waypoint firmvault adopt init --apply-safe --json'],
  },
  {
    slug: 'firmvault.evidence.check',
    command: 'waypoint firmvault evidence check --path <path> --json',
    description: 'Validate a relative evidence path before a state mutation.',
    inputs: [{ name: 'path', required: true, description: 'Relative evidence path inside the case folder.' }],
    evidence_behavior: 'validates that the path is safe, relative, inside the case folder, and exists',
    side_effect_class: 'read_only',
    can_affect_legal_landmarks: false,
    safety_notes: ['Use before firmvault.state.set when uncertain about evidence path validity.'],
    examples: ['waypoint firmvault evidence check --path documents/inbox/document-001.pdf --json'],
  },
  {
    slug: 'firmvault.state.show',
    command: 'waypoint firmvault state show --json',
    description: 'Read explicit FirmVault case state.',
    inputs: [{ name: 'section', required: false, description: 'Optional FirmVault state section to inspect.' }],
    evidence_behavior: 'read-only; reports evidence references already stored in state',
    side_effect_class: 'read_only',
    can_affect_legal_landmarks: false,
    safety_notes: ['Workflow truth comes from explicit YAML state, not arbitrary document presence.'],
    examples: ['waypoint firmvault state show --json', 'waypoint firmvault state show --section demand --json'],
  },
  {
    slug: 'firmvault.state.set',
    command: 'waypoint firmvault state set --fact <fact> --status <status> --evidence <path> --json',
    description: 'Mutate one validated FirmVault legal fact with safe evidence and audit logging.',
    inputs: [
      { name: 'fact', required: true, description: 'Fact slug from the FirmVault legal fact registry.' },
      { name: 'status', required: true, description: 'Allowed status for the selected fact.' },
      { name: 'evidence', required: true, repeatable: true, description: 'Validated relative evidence path supporting the fact update.' },
      { name: 'note', required: false, description: 'Optional operator note for the audit event.' },
    ],
    evidence_behavior: 'requires validated evidence for substantive legal progress',
    side_effect_class: 'local_state_mutation',
    can_affect_legal_landmarks: true,
    safety_notes: [
      'Only registry-defined facts and statuses are accepted.',
      'Legal landmarks change only through explicit state plus validated evidence.',
      'Appends a local audit event for the mutation.',
    ],
    examples: [
      'waypoint firmvault state set --fact demand.send --status sent --evidence documents/demand/sent-demand.pdf --json',
    ],
  },
  {
    slug: 'firmvault.document.add',
    command: 'waypoint firmvault add-document --source <path> --kind <kind> --json',
    description: 'Copy a document into the local case folder and record intake metadata.',
    inputs: [
      { name: 'source', required: true, description: 'Absolute or resolvable local source document path.' },
      { name: 'kind', required: true, description: 'Coarse intake kind: medical-records, bill, insurance, police-report, correspondence, or unknown.' },
      { name: 'note', required: false, description: 'Optional intake note.' },
    ],
    evidence_behavior: 'copies source into documents/inbox and indexes it as potential evidence',
    side_effect_class: 'local_file_copy',
    can_affect_legal_landmarks: false,
    safety_notes: ['Document intake alone never satisfies legal landmarks.'],
    examples: ['waypoint firmvault add-document --source /tmp/scan.pdf --kind medical-records --json'],
  },
  {
    slug: 'firmvault.document.handoff',
    command: 'waypoint firmvault document-handoff --document-id <id> --status <status> --json',
    description: 'Record document-pipeline handoff metadata without satisfying legal landmarks.',
    inputs: [
      { name: 'document-id', required: true, description: 'Document id from .waypoint/firmvault/documents.yaml.' },
      { name: 'status', required: true, description: 'Pipeline handoff status.' },
      { name: 'pr-url', required: false, description: 'Optional Forgejo/Git PR URL.' },
      { name: 'pr-number', required: false, description: 'Optional Forgejo/Git PR number.' },
    ],
    evidence_behavior: 'records external review metadata but does not make it legal evidence by itself',
    side_effect_class: 'external_handoff_metadata',
    can_affect_legal_landmarks: false,
    safety_notes: ['PR merge/review state is handoff metadata; substantive facts still require state.set.'],
    examples: ['waypoint firmvault document-handoff --document-id document-001 --status pr-opened --pr-url http://localhost:3001/org/repo/pulls/1 --json'],
  },
  {
    slug: 'firmvault.landmarks',
    command: 'waypoint firmvault landmarks --json',
    description: 'Project deterministic FirmVault landmarks from explicit state.',
    inputs: [],
    evidence_behavior: 'read-only; reports whether referenced evidence currently validates',
    side_effect_class: 'read_only',
    can_affect_legal_landmarks: false,
    safety_notes: ['Projection is deterministic from state YAML plus safe evidence-path checks.'],
    examples: ['waypoint firmvault landmarks --json'],
  },
  {
    slug: 'firmvault.export.waypoint_cases',
    command: 'pnpm smoke:firmvault-waypoint-case-export',
    description: 'Smoke-test export/adoption of legacy case folders into waypoint_cases copies.',
    inputs: [],
    evidence_behavior: 'uses local export/adoption smoke fixtures and copied case folders',
    side_effect_class: 'local_file_copy',
    can_affect_legal_landmarks: false,
    safety_notes: ['Runs as an explicit smoke command, not as implicit operator behavior.', 'Does not mutate the legacy source folder.'],
    examples: ['pnpm smoke:firmvault-waypoint-case-export'],
  },
] as const

const TOOL_DEFINITIONS_BY_SLUG = new Map(TOOL_DEFINITIONS.map((tool) => [tool.slug, tool]))

export async function listWaypointToolsForOperator(operatorSlug: string): Promise<ListWaypointToolsResult> {
  const loaded = await loadBundledOperators()
  if (loaded.ok === false) {
    return { ok: false, code: 'load_error', error: loaded.errors.map((error) => error.message).join('; ') }
  }

  const operator = loaded.operators.find((candidate) => candidate.slug === operatorSlug)
  if (!operator) return { ok: false, code: 'unknown_operator', error: `Unknown operator: ${operatorSlug}` }

  return { ok: true, operator_slug: operator.slug, tools: toolsForOperator(operator) }
}

export async function explainWaypointTool(toolSlug: string): Promise<ExplainWaypointToolResult> {
  const tool = TOOL_DEFINITIONS_BY_SLUG.get(toolSlug)
  if (!tool) return { ok: false, code: 'unknown_tool', error: `Unknown tool: ${toolSlug}` }
  return { ok: true, tool }
}

export function getWaypointToolRegistry(): readonly WaypointToolDefinition[] {
  return TOOL_DEFINITIONS
}

function toolsForOperator(operator: OperatorManifest): readonly WaypointToolDefinition[] {
  const allowedSlugs = new Set((operator.allowed_tools ?? []).map((tool) => tool.slug))
  return TOOL_DEFINITIONS.filter((tool) => allowedSlugs.has(tool.slug))
}
