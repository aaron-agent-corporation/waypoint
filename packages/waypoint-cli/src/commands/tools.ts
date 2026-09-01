import { explainWaypointTool, listWaypointToolsForOperator, type WaypointToolDefinition } from '@waypoint-engine/core'

import type { WaypointCliIo } from '../bin.ts'

const usage = `Waypoint tools

Usage:
  waypoint tools list --operator <slug> [--json]
  waypoint tools explain <tool-slug> [--json]
`

export async function runToolsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args
  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.stdout(usage.trimEnd())
    return 0
  }

  if (subcommand === 'list') return runList(args.slice(1), io)
  if (subcommand === 'explain') return runExplain(args.slice(1), io)

  io.stderr(`Unknown tools command: ${subcommand}`)
  io.stderr(usage.trimEnd())
  return 1
}

async function runList(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const operatorIndex = args.indexOf('--operator')
  if (operatorIndex === -1 || !args[operatorIndex + 1]) {
    io.stderr('Missing required option: --operator <slug>')
    return 1
  }
  const operatorSlug = args[operatorIndex + 1]
  const consumed = new Set([operatorIndex, operatorIndex + 1])
  const unknown = args.filter((arg, index) => arg !== '--json' && !consumed.has(index))
  if (unknown.length > 0) {
    io.stderr(`Unknown option(s): ${unknown.join(', ')}`)
    return 1
  }

  const result = await listWaypointToolsForOperator(operatorSlug)
  if (result.ok === false) {
    io.stderr(result.error)
    return 1
  }

  if (json) {
    io.stdout(JSON.stringify(result, null, 2))
    return 0
  }

  io.stdout(`Tools for ${result.operator_slug}`)
  for (const tool of result.tools) {
    io.stdout(`- ${tool.slug}: ${tool.command}`)
  }
  return 0
}

async function runExplain(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const positional = args.filter((arg) => arg !== '--json')
  const slug = positional[0]
  const extras = positional.slice(1)
  if (!slug) {
    io.stderr('Missing tool slug')
    return 1
  }
  if (extras.length > 0) {
    io.stderr(`Unexpected argument(s): ${extras.join(', ')}`)
    return 1
  }

  const result = await explainWaypointTool(slug)
  if (result.ok === false) {
    io.stderr(result.error)
    return 1
  }

  if (json) {
    io.stdout(JSON.stringify(result.tool, null, 2))
    return 0
  }

  printTool(result.tool, io)
  return 0
}

function printTool(tool: WaypointToolDefinition, io: WaypointCliIo): void {
  io.stdout(`${tool.slug}`)
  io.stdout(`command: ${tool.command}`)
  io.stdout(`description: ${tool.description}`)
  io.stdout(`side effect: ${tool.side_effect_class}`)
  io.stdout(`can affect domain landmarks: ${tool.can_affect_domain_landmarks ? 'yes' : 'no'}`)
  if (tool.inputs.length > 0) {
    io.stdout('inputs:')
    for (const input of tool.inputs) {
      io.stdout(`- ${input.name}${input.required ? ' (required)' : ' (optional)'}: ${input.description}`)
    }
  }
  if (tool.safety_notes.length > 0) {
    io.stdout('safety notes:')
    for (const note of tool.safety_notes) io.stdout(`- ${note}`)
  }
}
