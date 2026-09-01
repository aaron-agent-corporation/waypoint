/**
 * MCP stdio server exposing the bundled worker tools to the runtime.
 *
 * WHY HAND-ROLLED. MCP over stdio is newline-delimited JSON-RPC 2.0 and this
 * server answers four methods. The official SDK would be a new dependency in a
 * monorepo that has none for this, to save about sixty lines — and this process
 * runs INSIDE the worker's jail beside untrusted inputs, so a smaller surface
 * is worth more here than convenience.
 *
 * The server is spawned by the host runtime with the attempt's environment:
 * WAYPOINT_CLAIM_PATH names the claim file `report` writes, WAYPOINT_TASK_ID rides
 * into the claim, and `--case-root` (or WAYPOINT_CASE_ROOT) sets the working
 * context. A host replacing this surface with its own MCP server must keep
 * those conventions — the runtime enforces nothing else about the tool list
 * except that a `report` tool must exist for the claim seam to work.
 */
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import { buildWorkerTools } from './tools.ts'
import type { ToolSpec } from './types.ts'

const PROTOCOL_VERSION = '2024-11-05'

interface Request {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

export async function serve(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<void> {
  const tools = buildWorkerTools()
  const byName = new Map(tools.map((t) => [t.name, t]))

  const send = (message: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(message)}\n`)
  }
  const reply = (id: number | string, result: unknown): void => send({ jsonrpc: '2.0', id, result })

  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    let request: Request
    try {
      request = JSON.parse(line) as Request
    } catch {
      continue // a malformed line is not a reason to take the server down
    }
    // Notifications carry no id and expect no reply.
    if (request.id === undefined) continue

    switch (request.method) {
      case 'initialize':
        reply(request.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'waypoint-worker-tools', version: '0.1.0' },
        })
        break
      case 'tools/list':
        reply(request.id, { tools: tools.map(describe) })
        break
      case 'tools/call': {
        const name = String(request.params?.name ?? '')
        const tool = byName.get(name)
        if (!tool) {
          reply(request.id, {
            content: [{ type: 'text', text: `ERROR: no such tool "${name}". Available: ${[...byName.keys()].join(', ')}` }],
            isError: true,
          })
          break
        }
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>
        try {
          reply(request.id, await tool.execute(args))
        } catch (error) {
          // A thrown tool is a bug, but the worker still needs a usable turn:
          // an error IN the result keeps the conversation going, where a
          // JSON-RPC error frame usually ends it.
          reply(request.id, {
            content: [{ type: 'text', text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          })
        }
        break
      }
      case 'ping':
        reply(request.id, {})
        break
      default:
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `unknown method: ${request.method}` } })
    }
  }
}

function describe(tool: ToolSpec): Record<string, unknown> {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
}

// Full-path comparison, deliberately: a basename-suffix guard can start this
// server when another package's identically-named entry is merely imported.
// A file only serves when it IS argv[1]. The `--case-root` argument is
// accepted for interface compatibility with host-provided servers; the
// bundled surface has no per-project state to load.
// argv[1] can arrive through a symlink (npm .bin shims) while import.meta.url
// is the realpath — resolve before comparing or the server silently no-ops.
{
  const entry = process.argv[1]
  let resolvedEntry: string | undefined
  try {
    resolvedEntry = entry ? realpathSync(entry) : undefined
  } catch {
    resolvedEntry = entry
  }
  if (entry && (import.meta.url === pathToFileURL(resolvedEntry as string).href || import.meta.url === pathToFileURL(entry).href)) {
    await serve(process.stdin, process.stdout)
  }
}
