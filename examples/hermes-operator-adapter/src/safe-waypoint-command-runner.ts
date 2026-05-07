import { spawn } from 'node:child_process'

import type { HermesProjectRecord } from './project-registry.ts'

export interface SafeWaypointCommandSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly mutation: boolean
  readonly summaryHint: string
}

export interface WaypointCommandResult {
  readonly ok: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly command: string
  readonly mutation: boolean
  readonly summaryHint: string
}

export type WaypointCommandExecutor = (spec: SafeWaypointCommandSpec) => Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}>

export interface RunSafeWaypointCommandOptions {
  readonly executor?: WaypointCommandExecutor
}

type CommandRule = {
  readonly mutation: boolean
  readonly summaryHint: string
  readonly allowedFlags: Readonly<Record<string, 'value' | 'boolean'>>
  readonly requiredFlags?: readonly string[]
  readonly customValidate?: (args: readonly string[]) => void
}

const COMMAND_RULES: Readonly<Record<string, CommandRule>> = {
  status: {
    mutation: false,
    summaryHint: 'status',
    allowedFlags: {},
  },
  routes: {
    mutation: false,
    summaryHint: 'routes',
    allowedFlags: { '--json': 'boolean' },
  },
  route: {
    mutation: false,
    summaryHint: 'route',
    allowedFlags: { '--route-id': 'value', '--json': 'boolean' },
    requiredFlags: ['--route-id'],
  },
  'route-events': {
    mutation: false,
    summaryHint: 'route-events',
    allowedFlags: { '--route-id': 'value', '--limit': 'value', '--offset': 'value', '--json': 'boolean' },
    requiredFlags: ['--route-id'],
  },
  tasks: {
    mutation: false,
    summaryHint: 'tasks',
    allowedFlags: { '--route-id': 'value', '--json': 'boolean' },
  },
  discuss: {
    mutation: true,
    summaryHint: 'discuss',
    allowedFlags: { '--task-id': 'value', '--message': 'value', '--author': 'value' },
    requiredFlags: ['--task-id'],
  },
  auto: {
    mutation: true,
    summaryHint: 'auto',
    allowedFlags: { '--route-id': 'value', '--max-iterations': 'value', '--json': 'boolean' },
  },
  gate: {
    mutation: true,
    summaryHint: 'gate',
    allowedFlags: {
      '--route-id': 'value',
      '--node': 'value',
      '--approve': 'boolean',
      '--reject': 'boolean',
      '--note': 'value',
      '--next-node': 'value',
    },
    requiredFlags: ['--route-id', '--node'],
    customValidate: (args) => {
      const approvals = Number(args.includes('--approve')) + Number(args.includes('--reject'))
      if (approvals !== 1) throw new Error('Waypoint gate requires exactly one of --approve or --reject')
    },
  },
  pause: {
    mutation: true,
    summaryHint: 'pause',
    allowedFlags: { '--route-id': 'value', '--reason': 'value' },
    requiredFlags: ['--route-id'],
  },
  resume: {
    mutation: true,
    summaryHint: 'resume',
    allowedFlags: { '--route-id': 'value' },
    requiredFlags: ['--route-id'],
  },
}

export function buildSafeWaypointCommand(
  project: HermesProjectRecord,
  waypointArgs: readonly string[],
): SafeWaypointCommandSpec {
  const [command, ...rest] = waypointArgs
  if (!command) throw new Error('Waypoint command is required')

  if (command === 'auto' && rest[0] === 'status') {
    const subcommandArgs = rest.slice(1)
    validateFlags('auto status', subcommandArgs, {
      mutation: false,
      summaryHint: 'auto status',
      allowedFlags: { '--limit': 'value', '--offset': 'value', '--json': 'boolean' },
    })
    return {
      command: process.execPath,
      args: [project.waypointCli, command, 'status', ...subcommandArgs],
      cwd: project.path,
      mutation: false,
      summaryHint: 'auto status',
    }
  }

  const rule = COMMAND_RULES[command]
  if (!rule) throw new Error(`Waypoint command is not allowlisted: ${command}`)

  validateFlags(command, rest, rule)

  return {
    command: process.execPath,
    args: [project.waypointCli, command, ...rest],
    cwd: project.path,
    mutation: rule.mutation,
    summaryHint: rule.summaryHint,
  }
}

export async function runSafeWaypointCommand(
  project: HermesProjectRecord,
  waypointArgs: readonly string[],
  options: RunSafeWaypointCommandOptions = {},
): Promise<WaypointCommandResult> {
  const spec = buildSafeWaypointCommand(project, waypointArgs)
  const executor = options.executor ?? executeWaypointCommand
  const result = await executor(spec)
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    command: `waypoint ${waypointArgs.join(' ')}`,
    mutation: spec.mutation,
    summaryHint: spec.summaryHint,
  }
}

async function executeWaypointCommand(spec: SafeWaypointCommandSpec): Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}> {
  return await new Promise((resolvePromise) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

function validateFlags(command: string, args: readonly string[], rule: CommandRule): void {
  const seenFlags = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) {
      throw new Error(`Waypoint ${command} does not allow positional argument: ${token}`)
    }

    const flagShape = rule.allowedFlags[token]
    if (!flagShape) throw new Error(`Waypoint ${command} does not allow flag: ${token}`)
    seenFlags.add(token)

    if (flagShape === 'value') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`Waypoint ${command} requires a value for ${token}`)
      index += 1
    }
  }

  for (const requiredFlag of rule.requiredFlags ?? []) {
    if (!seenFlags.has(requiredFlag)) throw new Error(`Waypoint ${command} requires ${requiredFlag}`)
  }

  rule.customValidate?.(args)
}
