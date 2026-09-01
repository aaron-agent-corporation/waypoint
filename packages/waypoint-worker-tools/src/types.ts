/** MCP's tool-result shape; the worker runtime's adapters use it unchanged. */
export interface ToolResult {
  readonly content: { type: 'text'; text: string }[]
  readonly isError?: boolean
}

/**
 * A tool the bundled server offers a worker.
 *
 * The bundled surface is deliberately minimal: `report` is the only tool every
 * worker on every quest needs, because it is the claim seam — the single way an
 * attempt tells the host how it ended. Domain capabilities (reading a host's
 * documents, staging domain rows) belong to a host-provided MCP server passed
 * to the runtime as `toolServer`, never to this bundle.
 */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  /** JSON Schema, passed through to the model unchanged. */
  readonly inputSchema: Record<string, unknown>
  execute(params: Record<string, unknown>): Promise<ToolResult>
}

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
