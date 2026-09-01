import { dirname } from 'node:path'

import { loadBundledOperators, resolveOperatorInstructions, type OperatorManifest } from '@waypoint-engine/core'

import type { WaypointCliIo } from '../bin.ts'

const usage = `Waypoint operators

Usage:
  waypoint operators list [--json]
  waypoint operators show <slug> [--json]
  waypoint operators instructions <slug> [--json]
`

export async function runOperatorsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args
  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.stdout(usage.trimEnd())
    return 0
  }

  if (subcommand === 'list') return runList(args.slice(1), io)
  if (subcommand === 'show') return runShow(args.slice(1), io)
  if (subcommand === 'instructions') return runInstructions(args.slice(1), io)

  io.stderr(`Unknown operators command: ${subcommand}`)
  io.stderr(usage.trimEnd())
  return 1
}

async function runList(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const unknown = args.filter((arg) => arg !== '--json')
  if (unknown.length > 0) {
    io.stderr(`Unknown option(s): ${unknown.join(', ')}`)
    return 1
  }

  const loaded = await loadBundledOperators()
  if (loaded.ok === false) {
    io.stderr(`Failed to load operators: ${loaded.errors.map((error) => error.message).join('; ')}`)
    return 1
  }

  if (json) {
    io.stdout(JSON.stringify({ operators: loaded.operators }, null, 2))
    return 0
  }

  io.stdout('Operators')
  for (const operator of loaded.operators) {
    io.stdout(`- ${operator.slug}: ${operator.name}`)
  }
  return 0
}

async function runShow(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const positional = args.filter((arg) => arg !== '--json')
  const slug = positional[0]
  const extras = positional.slice(1)
  if (!slug) {
    io.stderr('Missing operator slug')
    return 1
  }
  if (extras.length > 0) {
    io.stderr(`Unexpected argument(s): ${extras.join(', ')}`)
    return 1
  }

  const loaded = await loadBundledOperators()
  if (loaded.ok === false) {
    io.stderr(`Failed to load operators: ${loaded.errors.map((error) => error.message).join('; ')}`)
    return 1
  }
  const operator = loaded.operators.find((entry) => entry.slug === slug)
  if (!operator) {
    io.stderr(`Unknown operator: ${slug}`)
    return 1
  }

  if (json) {
    io.stdout(JSON.stringify(operator, null, 2))
    return 0
  }

  printOperator(operator, io)
  return 0
}

async function runInstructions(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const positional = args.filter((arg) => arg !== '--json')
  const slug = positional[0]
  const extras = positional.slice(1)
  if (!slug) {
    io.stderr('Missing operator slug')
    return 1
  }
  if (extras.length > 0) {
    io.stderr(`Unexpected argument(s): ${extras.join(', ')}`)
    return 1
  }

  const loaded = await loadBundledOperators()
  if (loaded.ok === false) {
    io.stderr(`Failed to load operators: ${loaded.errors.map((error) => error.message).join('; ')}`)
    return 1
  }
  const entry = loaded.entries.find((candidate) => candidate.slug === slug)
  if (!entry) {
    io.stderr(`Unknown operator: ${slug}`)
    return 1
  }

  const repoRoot = dirname(dirname(dirname(entry.path)))
  const resolution = await resolveOperatorInstructions(entry.manifest, { repoRoot })
  if (json) {
    io.stdout(JSON.stringify(resolution, null, 2))
    return 0
  }

  io.stdout(`Instruction layers for ${resolution.operator_slug}`)
  for (const layer of resolution.layers) {
    io.stdout(`- ${layer.kind}: ${layer.ref} [${layer.exists ? 'present' : 'missing'}${layer.required ? ', required' : ', optional'}]`)
  }
  for (const warning of resolution.warnings) io.stdout(`warning: ${warning}`)
  for (const error of resolution.errors) io.stdout(`error: ${error}`)
  return 0
}

function printOperator(operator: OperatorManifest, io: WaypointCliIo): void {
  io.stdout(`${operator.name} (${operator.slug})`)
  io.stdout(`role: ${operator.role}`)
  if (operator.description) io.stdout(`description: ${operator.description}`)
  if (operator.instructions?.layers && operator.instructions.layers.length > 0) {
    io.stdout('instruction layers:')
    for (const layer of operator.instructions.layers) {
      io.stdout(`- ${layer.kind}: ${layer.ref}${layer.required ? ' (required)' : ''}`)
    }
  }
  if (operator.allowed_tools && operator.allowed_tools.length > 0) {
    io.stdout('allowed tools:')
    for (const tool of operator.allowed_tools) {
      io.stdout(`- ${tool.slug}: ${tool.command ?? '(no command template)'}`)
    }
  }
}
