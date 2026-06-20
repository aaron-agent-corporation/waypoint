import { Type, type TSchema } from '@sinclair/typebox'

import { HostCommandError, type HostClient } from './host-client.ts'

/**
 * The Waypoint tools the agent may call. The command set MUST equal the
 * engine-host `AGENT_TOOL_GRANT` (host-enforced via the scoped token) — a test
 * asserts parity. `author.approveProposal` and `workspace.open` are absent here
 * AND rejected by the host, so the agent can neither land proposals nor switch
 * workspaces even via direct loopback (MAR Contract Lock 5).
 */

/** A loose object schema — the host is the source of truth for payload validation. */
const OpenObject = Type.Object({}, { additionalProperties: true })

export interface WaypointToolSpec {
  /** snake_case tool name the LLM calls. */
  readonly name: string
  /** Dotted engine-host command this tool dispatches. */
  readonly command: string
  readonly label: string
  readonly description: string
  readonly parameters: TSchema
}

export const WAYPOINT_TOOL_SPECS: readonly WaypointToolSpec[] = Object.freeze([
  { name: 'waypoint_author_recipe', command: 'author.recipe', label: 'Author Recipe', description: 'Generate a Waypoint Recipe draft from a spec. Returns a validated draft (not yet promoted).', parameters: Type.Object({ spec: OpenObject }) },
  { name: 'waypoint_author_quest', command: 'author.quest', label: 'Author Quest', description: 'Generate a Waypoint Quest draft from a spec. Returns a validated draft (not yet promoted).', parameters: Type.Object({ spec: OpenObject }) },
  { name: 'waypoint_author_design_spec', command: 'author.designSpec', label: 'Author Design Spec', description: 'Generate a design spec draft from an input description.', parameters: Type.Object({ input: OpenObject }) },
  { name: 'waypoint_author_handoff', command: 'author.handoff', label: 'Author Handoff', description: 'Generate a handoff draft from an input description.', parameters: Type.Object({ input: OpenObject }) },
  { name: 'waypoint_author_promote', command: 'author.promote', label: 'Promote Draft', description: 'Write a draft as a PENDING proposal for human review. Does NOT land it in the catalog.', parameters: Type.Object({ draft: OpenObject }) },
  { name: 'waypoint_run_adhoc', command: 'run.adhoc', label: 'Run Ad-hoc', description: 'Execute an authored quest+recipes ad-hoc from a session overlay (folder backend). Set dryRun to materialize without executing.', parameters: Type.Object({ questYaml: Type.String(), recipeYamls: Type.Optional(Type.Array(Type.String())), dryRun: Type.Optional(Type.Boolean()) }) },
  { name: 'waypoint_catalog_quests', command: 'catalog.quests', label: 'List Catalog Quests', description: 'List the Quests available in the bundled catalog.', parameters: Type.Object({}) },
  { name: 'waypoint_catalog_recipes', command: 'catalog.recipes', label: 'List Catalog Recipes', description: 'List the Recipes available in the bundled catalog.', parameters: Type.Object({}) },
  { name: 'waypoint_routes_list', command: 'routes.list', label: 'List Routes', description: 'List the workspace routes.', parameters: Type.Object({}) },
  { name: 'waypoint_route_get', command: 'route.get', label: 'Get Route', description: 'Fetch a single route by id.', parameters: Type.Object({ routeId: Type.String() }) },
  { name: 'waypoint_route_events', command: 'route.events', label: 'Route Events', description: 'Read a route event page.', parameters: Type.Object({ routeId: Type.String(), limit: Type.Optional(Type.Number()), offset: Type.Optional(Type.Number()) }) },
  { name: 'waypoint_tasks_list', command: 'tasks.list', label: 'List Tasks', description: 'List tasks, optionally filtered by routeId.', parameters: Type.Object({ routeId: Type.Optional(Type.String()) }) },
  { name: 'waypoint_meta_commands', command: 'meta.commands', label: 'List Commands', description: 'List the engine-host commands this session may call.', parameters: Type.Object({}) },
  { name: 'waypoint_meta_version', command: 'meta.version', label: 'Engine Version', description: 'Report the engine-host version and health.', parameters: Type.Object({}) },
])

export interface WaypointToolResult {
  content: { type: 'text'; text: string }[]
  details: Record<string, unknown>
  isError?: boolean
}

export interface WaypointTool extends WaypointToolSpec {
  execute(params: Record<string, unknown>): Promise<WaypointToolResult>
}

/** Bind every Waypoint tool spec to a host client, producing callable tools. */
export function buildWaypointTools(client: HostClient): WaypointTool[] {
  return WAYPOINT_TOOL_SPECS.map((spec) => ({
    ...spec,
    async execute(params: Record<string, unknown>): Promise<WaypointToolResult> {
      try {
        const result = await client.command(spec.command, params ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
      } catch (error) {
        if (error instanceof HostCommandError) {
          return { content: [{ type: 'text', text: `${error.code}: ${error.message}` }], details: { code: error.code }, isError: true }
        }
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: {}, isError: true }
      }
    },
  }))
}
