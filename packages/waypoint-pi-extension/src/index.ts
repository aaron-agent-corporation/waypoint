import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

import { createHostClient } from './host-client.ts'
import { buildWaypointTools } from './tools.ts'

export { createHostClient, HostCommandError } from './host-client.ts'
export type { HostClient, HostClientConfig } from './host-client.ts'
export { buildWaypointTools, WAYPOINT_TOOL_SPECS } from './tools.ts'
export type { WaypointTool, WaypointToolSpec, WaypointToolResult } from './tools.ts'

/**
 * Pi extension entry point. Loaded via `pi -e <this>`; Pi calls the default
 * export with its `ExtensionAPI`. We read the loopback callback credentials the
 * `PiCliBrainAdapter` injected into the child env and register the granted
 * Waypoint tools. The token is the per-session SCOPED token — the host enforces
 * the grant regardless of what this extension exposes.
 */
export default function activateWaypointExtension(pi: ExtensionAPI): void {
  const url = process.env.WAYPOINT_HOST_URL
  const token = process.env.WAYPOINT_HOST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Waypoint Pi extension requires WAYPOINT_HOST_URL and WAYPOINT_HOST_TOKEN in the environment ' +
        '(injected by the engine-host PiCliBrainAdapter).',
    )
  }

  const client = createHostClient({ url, token })
  for (const tool of buildWaypointTools(client)) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      execute: (_toolCallId, params) => tool.execute((params ?? {}) as Record<string, unknown>),
    })
  }
}
