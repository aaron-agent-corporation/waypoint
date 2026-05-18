import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

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
  readonly customValidate?: (args: readonly string[], project: HermesProjectRecord) => void
}

const FIRMVAULT_DOCUMENT_KINDS = new Set(['medical-records', 'medical_records', 'bill', 'insurance', 'police-report', 'police_report', 'correspondence', 'unknown'])
const FIRMVAULT_HANDOFF_STATUSES = new Set(['not-started', 'not_started', 'submitted', 'pr-opened', 'pr_opened', 'merged', 'deferred', 'failed'])
const FIRMVAULT_STATE_SECTIONS = new Set(['case', 'client', 'accident', 'providers', 'insurance', 'liens', 'records', 'demand', 'negotiation', 'settlement', 'documents'])

const COMMAND_RULES: Readonly<Record<string, CommandRule>> = {
  status: {
    mutation: false,
    summaryHint: 'status',
    allowedFlags: {},
  },
  quests: {
    mutation: false,
    summaryHint: 'quests',
    allowedFlags: { '--json': 'boolean' },
  },
  recipes: {
    mutation: false,
    summaryHint: 'recipes',
    allowedFlags: { '--quest': 'value', '--json': 'boolean' },
    customValidate: validateOptionalQuestSlug('recipes'),
  },
  init: {
    mutation: true,
    summaryHint: 'init',
    allowedFlags: { '--quest': 'value' },
    customValidate: validateOptionalQuestSlug('init'),
  },
  start: {
    mutation: true,
    summaryHint: 'start',
    allowedFlags: { '--quest': 'value', '--json': 'boolean' },
    customValidate: validateOptionalQuestSlug('start'),
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
    }, project)
    return {
      command: process.execPath,
      args: [project.waypointCli, command, 'status', ...subcommandArgs],
      cwd: project.path,
      mutation: false,
      summaryHint: 'auto status',
    }
  }

  if (command === 'firmvault') {
    const [subcommand, ...subcommandArgs] = rest
    if (subcommand === 'bootstrap') {
      return buildFirmVaultCommand(project, subcommand, subcommandArgs, {
        mutation: true,
        summaryHint: 'firmvault bootstrap',
        allowedFlags: {
          '--cases-root': 'value',
          '--case-name': 'value',
          '--case-type': 'value',
          '--case-slug': 'value',
          '--start': 'boolean',
          '--json': 'boolean',
        },
        requiredFlags: ['--cases-root', '--case-name', '--case-type'],
        customValidate: (args, registeredProject) => {
          const casesRootIndex = args.indexOf('--cases-root')
          const caseTypeIndex = args.indexOf('--case-type')
          if (casesRootIndex === -1 || args[casesRootIndex + 1] !== registeredProject.path) {
            throw new Error('Waypoint firmvault bootstrap requires --cases-root to match the registered project path')
          }
          if (caseTypeIndex === -1 || args[caseTypeIndex + 1] !== 'personal-injury') {
            throw new Error('Waypoint firmvault bootstrap only allows --case-type personal-injury')
          }
        },
      })
    }
    if (subcommand === 'add-document') {
      return buildFirmVaultCommand(project, subcommand, subcommandArgs, {
        mutation: true,
        summaryHint: 'firmvault add-document',
        allowedFlags: { '--source': 'value', '--kind': 'value', '--note': 'value', '--json': 'boolean' },
        requiredFlags: ['--source', '--kind'],
        customValidate: validateFirmVaultAddDocument,
      })
    }
    if (subcommand === 'document-handoff') {
      return buildFirmVaultCommand(project, subcommand, subcommandArgs, {
        mutation: true,
        summaryHint: 'firmvault document-handoff',
        allowedFlags: {
          '--document-id': 'value',
          '--status': 'value',
          '--pr-number': 'value',
          '--pr-url': 'value',
          '--branch': 'value',
          '--submitted-at': 'value',
          '--completed-at': 'value',
          '--json': 'boolean',
        },
        requiredFlags: ['--document-id', '--status'],
        customValidate: validateFirmVaultDocumentHandoff,
      })
    }
    if (subcommand === 'state') {
      const [stateAction, ...stateActionArgs] = subcommandArgs
      if (stateAction === 'show') {
        return buildFirmVaultNestedCommand(project, ['state', 'show'], stateActionArgs, {
          mutation: false,
          summaryHint: 'firmvault state show',
          allowedFlags: { '--section': 'value', '--json': 'boolean' },
          customValidate: validateFirmVaultStateShow,
        })
      }
      if (stateAction === 'set') {
        return buildFirmVaultNestedCommand(project, ['state', 'set'], stateActionArgs, {
          mutation: true,
          summaryHint: 'firmvault state set',
          allowedFlags: { '--fact': 'value', '--status': 'value', '--evidence': 'value', '--note': 'value', '--json': 'boolean' },
          requiredFlags: ['--fact', '--status'],
          customValidate: validateFirmVaultStateSet,
        })
      }
      throw new Error(`Waypoint firmvault state action is not allowlisted: ${stateAction ?? '<missing>'}`)
    }
    if (subcommand === 'evidence') {
      const [evidenceAction, ...evidenceActionArgs] = subcommandArgs
      if (evidenceAction === 'check') {
        return buildFirmVaultNestedCommand(project, ['evidence', 'check'], evidenceActionArgs, {
          mutation: false,
          summaryHint: 'firmvault evidence check',
          allowedFlags: { '--path': 'value', '--json': 'boolean' },
          requiredFlags: ['--path'],
          customValidate: validateFirmVaultEvidenceCheck,
        })
      }
      throw new Error(`Waypoint firmvault evidence action is not allowlisted: ${evidenceAction ?? '<missing>'}`)
    }
    if (subcommand === 'landmarks') {
      return buildFirmVaultCommand(project, subcommand, subcommandArgs, {
        mutation: false,
        summaryHint: 'firmvault landmarks',
        allowedFlags: { '--json': 'boolean' },
      })
    }
    throw new Error(`Waypoint firmvault subcommand is not allowlisted: ${subcommand ?? '<missing>'}`)
  }

  const rule = COMMAND_RULES[command]
  if (!rule) throw new Error(`Waypoint command is not allowlisted: ${command}`)

  validateFlags(command, rest, rule, project)

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

function buildFirmVaultCommand(
  project: HermesProjectRecord,
  subcommand: string,
  args: readonly string[],
  rule: CommandRule,
): SafeWaypointCommandSpec {
  validateFlags(`firmvault ${subcommand}`, args, rule, project)
  return {
    command: process.execPath,
    args: [project.waypointCli, 'firmvault', subcommand, ...args],
    cwd: project.path,
    mutation: rule.mutation,
    summaryHint: rule.summaryHint,
  }
}

function buildFirmVaultNestedCommand(
  project: HermesProjectRecord,
  path: readonly string[],
  args: readonly string[],
  rule: CommandRule,
): SafeWaypointCommandSpec {
  validateFlags(`firmvault ${path.join(' ')}`, args, rule, project)
  return {
    command: process.execPath,
    args: [project.waypointCli, 'firmvault', ...path, ...args],
    cwd: project.path,
    mutation: rule.mutation,
    summaryHint: rule.summaryHint,
  }
}

function validateOptionalQuestSlug(command: string): (args: readonly string[]) => void {
  return (args) => {
    const quest = flagValue(args, '--quest')
    if (quest && !isSafeSlug(quest)) throw new Error(`Waypoint ${command} does not allow unsafe Quest slug: ${quest}`)
  }
}

function validateFirmVaultAddDocument(args: readonly string[]): void {
  const source = flagValue(args, '--source')
  const kind = flagValue(args, '--kind')
  if (source && !isAbsolute(source)) throw new Error('Waypoint firmvault add-document requires --source to be absolute')
  if (kind && !FIRMVAULT_DOCUMENT_KINDS.has(kind)) {
    throw new Error(`Waypoint firmvault add-document does not allow document kind: ${kind}`)
  }
}

function validateFirmVaultDocumentHandoff(args: readonly string[]): void {
  const status = flagValue(args, '--status')
  if (status && !FIRMVAULT_HANDOFF_STATUSES.has(status)) {
    throw new Error(`Waypoint firmvault document-handoff does not allow status: ${status}`)
  }
  const prNumber = flagValue(args, '--pr-number')
  if (prNumber && !/^\d+$/.test(prNumber)) throw new Error('Waypoint firmvault document-handoff requires --pr-number to be numeric')
}

function validateFirmVaultStateShow(args: readonly string[]): void {
  const section = flagValue(args, '--section')
  if (section && !FIRMVAULT_STATE_SECTIONS.has(section)) {
    throw new Error(`Waypoint firmvault state show does not allow section: ${section}`)
  }
}

function validateFirmVaultStateSet(args: readonly string[]): void {
  for (const evidencePath of flagValues(args, '--evidence')) {
    if (!isSafeRelativePath(evidencePath)) {
      throw new Error(`Waypoint firmvault state set requires --evidence to be a safe relative path: ${evidencePath}`)
    }
  }
}

function validateFirmVaultEvidenceCheck(args: readonly string[]): void {
  const evidencePath = flagValue(args, '--path')
  if (evidencePath && !isSafeRelativePath(evidencePath)) {
    throw new Error(`Waypoint firmvault evidence check requires --path to be a safe relative path: ${evidencePath}`)
  }
}

function validateFlags(command: string, args: readonly string[], rule: CommandRule, project: HermesProjectRecord): void {
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

  rule.customValidate?.(args, project)
}

function flagValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function flagValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) values.push(args[index + 1])
  }
  return values
}

function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug)
}

function isSafeRelativePath(path: string): boolean {
  return !isAbsolute(path)
    && path.trim() !== ''
    && !path.split(/[\\/]+/).includes('..')
}
