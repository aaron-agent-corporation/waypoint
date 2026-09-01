/**
 * A test-local MCP tool server — the generic stand-in for a host's domain
 * tool surface. The composition tests drive composition against a REAL live
 * child process because a mocked surface would pass the activation guard
 * vacuously, which is the one thing they exist to catch.
 *
 * Self-contained on purpose: the child is spawned under
 * `node --experimental-strip-types`, where the monorepo's tsconfig path
 * aliases do not resolve, so this file may import nothing.
 *
 * The surface: `alpha` and `gamma` in group 'one', `beta` in group 'two',
 * and `report` in every group (the claim seam, WAYPOINT_CLAIM_PATH) — enough to
 * prove grouping, the activation guard, and the policy fence without any
 * domain content.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const PROTOCOL_VERSION = '2024-11-05'
const GROUPS = ['one', 'two'] as const

interface Tool {
  readonly name: string
  readonly groups: readonly string[]
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  execute(params: Record<string, unknown>): Promise<unknown>
}

function echo(name: string): Tool['execute'] {
  return async (params) => ({
    content: [{ type: 'text', text: `${name} called with ${JSON.stringify(params)}` }],
  })
}

async function report(params: Record<string, unknown>): Promise<unknown> {
  const fail = (text: string): unknown => ({ content: [{ type: 'text', text }], isError: true })
  const claimPath = process.env.WAYPOINT_CLAIM_PATH
  if (!claimPath) return fail('ERROR: no claim path was provided to this worker (WAYPOINT_CLAIM_PATH unset). Report not filed.')
  const status = String(params.status ?? '')
  if (status !== 'finished' && status !== 'failed') return fail('ERROR: status must be "finished" or "failed".')
  const review = (params.review ?? {}) as Record<string, string>
  const evidence: Record<string, unknown> = {}
  for (const [check, verdict] of Object.entries(review)) evidence[`review.${check}`] = verdict
  await mkdir(claimPath.slice(0, claimPath.lastIndexOf('/')), { recursive: true })
  await writeFile(
    claimPath,
    `${JSON.stringify(
      {
        task_id: process.env.WAYPOINT_TASK_ID ?? undefined,
        status,
        summary: String(params.summary ?? ''),
        ...(typeof params.brief === 'string' && params.brief.trim() !== '' ? { brief: params.brief } : {}),
        evidence,
      },
      null,
      1,
    )}\n`,
    'utf8',
  )
  return { content: [{ type: 'text', text: `Report filed: ${status}.` }] }
}

const ALL_TOOLS: readonly Tool[] = [
  { name: 'alpha', groups: ['one'], description: 'Fixture tool alpha.', inputSchema: { type: 'object', properties: {} }, execute: echo('alpha') },
  { name: 'gamma', groups: ['one'], description: 'Fixture tool gamma.', inputSchema: { type: 'object', properties: {} }, execute: echo('gamma') },
  { name: 'beta', groups: ['two'], description: 'Fixture tool beta.', inputSchema: { type: 'object', properties: {} }, execute: echo('beta') },
  {
    name: 'report',
    groups: [...GROUPS],
    description: 'File the claim for this attempt.',
    inputSchema: {
      type: 'object',
      required: ['status', 'summary'],
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['finished', 'failed'] },
        summary: { type: 'string' },
        brief: { type: 'string' },
        review: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    execute: report,
  },
]

function parseGroup(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--group')
  const named = at !== -1 ? argv[at + 1] : process.env.WAYPOINT_TOOL_GROUP
  if (named === undefined) return undefined
  if (!(GROUPS as readonly string[]).includes(named)) {
    throw new Error(`tool group "${named}" is not one of: ${GROUPS.join(', ')}`)
  }
  return named
}

async function serve(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, group?: string): Promise<void> {
  const tools = ALL_TOOLS.filter((t) => group === undefined || t.groups.includes(group))
  const byName = new Map(tools.map((t) => [t.name, t]))
  const send = (message: Record<string, unknown>): void => {
    output.write(`${JSON.stringify(message)}\n`)
  }
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    let request: { id?: number | string; method: string; params?: Record<string, unknown> }
    try {
      request = JSON.parse(line) as typeof request
    } catch {
      continue
    }
    if (request.id === undefined) continue
    const reply = (result: unknown): void => send({ jsonrpc: '2.0', id: request.id, result })
    switch (request.method) {
      case 'initialize':
        reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'test-fixture-tools', version: '0.0.0' } })
        break
      case 'tools/list':
        reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
        break
      case 'tools/call': {
        const tool = byName.get(String(request.params?.name ?? ''))
        if (!tool) {
          reply({ content: [{ type: 'text', text: `ERROR: no such tool. Available: ${[...byName.keys()].join(', ')}` }], isError: true })
          break
        }
        try {
          reply(await tool.execute((request.params?.arguments ?? {}) as Record<string, unknown>))
        } catch (error) {
          reply({ content: [{ type: 'text', text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }], isError: true })
        }
        break
      }
      case 'ping':
        reply({})
        break
      default:
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `unknown method: ${request.method}` } })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serve(process.stdin, process.stdout, parseGroup(process.argv.slice(2)))
}
