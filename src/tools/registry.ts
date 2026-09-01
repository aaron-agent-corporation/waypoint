import { loadBundledOperators } from '../operators/loader.ts'
import type { OperatorManifest } from '../operators/manifest.ts'

export type WaypointToolSideEffectClass =
  | 'read_only'
  | 'external_read'
  | 'local_state_mutation'
  | 'local_file_copy'
  | 'external_handoff_metadata'

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
  readonly can_affect_domain_landmarks: boolean
  readonly safety_notes: readonly string[]
  readonly examples: readonly string[]
}

export type ListWaypointToolsResult =
  | { readonly ok: true; readonly operator_slug: string; readonly tools: readonly WaypointToolDefinition[] }
  | { readonly ok: false; readonly code: 'load_error' | 'unknown_operator'; readonly error: string }

export type ExplainWaypointToolResult =
  | { readonly ok: true; readonly tool: WaypointToolDefinition }
  | { readonly ok: false; readonly code: 'unknown_tool'; readonly error: string }

/**
 * The core registry ships with ONLY the two `example.*` definitions the bundled
 * `research-analyst` operator references — a worked example of the contract, not
 * a tool library. Real tool definitions are domain content owned by the host
 * application (the same extension-point posture as the artifact contracts and
 * deterministic entrypoint registries): a host registers its own via
 * `registerWaypointTool` at startup, and `waypoint tools list/explain` read whatever
 * is registered here.
 */
const EXAMPLE_TOOL_DEFINITIONS: readonly WaypointToolDefinition[] = [
  {
    slug: 'example.search',
    command: 'waypoint tools search --json',
    description: "Search the project's sources.",
    inputs: [
      { name: 'query', required: true, description: 'The search query.' },
      { name: 'limit', required: false, description: 'Maximum number of results.' },
    ],
    evidence_behavior: 'Results are cited as evidence entries on the task report.',
    side_effect_class: 'read_only',
    can_affect_domain_landmarks: false,
    safety_notes: ['Read-only: never writes to the project tree.'],
    examples: ['waypoint tools explain example.search --json'],
  },
  {
    slug: 'example.summarize',
    command: 'waypoint tools summarize --json',
    description: 'Summarize a gathered source into the project\'s notes.',
    inputs: [{ name: 'source_path', required: true, description: 'Path of the source to summarize.' }],
    evidence_behavior: 'The note path is cited as evidence on the task report.',
    side_effect_class: 'local_state_mutation',
    can_affect_domain_landmarks: false,
    safety_notes: ['Writes only under the project\'s notes root.'],
    examples: ['waypoint tools explain example.summarize --json'],
  },
] as const

const toolDefinitions: WaypointToolDefinition[] = [...EXAMPLE_TOOL_DEFINITIONS]

const TOOL_DEFINITIONS_BY_SLUG = new Map(toolDefinitions.map((tool) => [tool.slug, tool]))

/**
 * Host registration seam: add (or replace, by slug) a tool definition.
 * Re-registering a slug replaces the previous definition — hosts composing
 * layers need last-wins; there is no unregister because a registry that
 * shrinks under a running host hides misconfiguration.
 */
export function registerWaypointTool(definition: WaypointToolDefinition): void {
  TOOL_DEFINITIONS_BY_SLUG.set(definition.slug, definition)
  const index = toolDefinitions.findIndex((tool) => tool.slug === definition.slug)
  if (index === -1) toolDefinitions.push(definition)
  else toolDefinitions[index] = definition
}

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
  return toolDefinitions
}

function toolsForOperator(operator: OperatorManifest): readonly WaypointToolDefinition[] {
  const allowedSlugs = new Set((operator.allowed_tools ?? []).map((tool) => tool.slug))
  return toolDefinitions.filter((tool) => allowedSlugs.has(tool.slug))
}
