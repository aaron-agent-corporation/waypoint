import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseDocument } from 'yaml'

import { SpawnWaypointBeadsCliCommandRunner, type WaypointBeadsCliCommandRunner } from './cli-client.ts'

export type WaypointBeadsWorkspaceReadinessStatus =
  | 'ready'
  | 'missing-command'
  | 'missing-workspace'
  | 'unhealthy'

export interface WaypointBeadsWorkspaceReadiness {
  readonly ok: boolean
  readonly status: WaypointBeadsWorkspaceReadinessStatus
  readonly message: string
  readonly hint: string
  readonly path?: string
  readonly databasePath?: string
  readonly prefix?: string
  readonly details?: string
}

export interface WaypointBeadsWorkspaceOptions {
  readonly command?: string
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly prefix?: string
  readonly runner?: WaypointBeadsCliCommandRunner
}

export async function checkWaypointBeadsWorkspace(
  options: WaypointBeadsWorkspaceOptions = {},
): Promise<WaypointBeadsWorkspaceReadiness> {
  const command = options.command ?? 'bd'
  const runner = options.runner ?? new SpawnWaypointBeadsCliCommandRunner()
  try {
    const output = await runner.run({
      command,
      args: ['where', '--json'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    })
    const parsed = parseOptionalJson(output.stdout)
    if (output.exitCode === 0) {
      return readyReadiness(parsed)
    }
    return failedReadinessFromWhere(parsed, output.stderr)
  } catch (error) {
    if (isMissingCommandError(error)) {
      return {
        ok: false,
        status: 'missing-command',
        message: 'Beads route backend requires the bd CLI, but bd was not found.',
        hint: 'Install Beads, make bd available on PATH, or initialize the project with --backend folder.',
        details: error instanceof Error ? error.message : String(error),
      }
    }
    return {
      ok: false,
      status: 'unhealthy',
      message: 'Beads workspace readiness check failed before bd returned a result.',
      hint: 'Run bd where --json from the project root to inspect the Beads workspace.',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function initializeWaypointBeadsWorkspace(
  options: WaypointBeadsWorkspaceOptions = {},
): Promise<WaypointBeadsWorkspaceReadiness> {
  const command = options.command ?? 'bd'
  const runner = options.runner ?? new SpawnWaypointBeadsCliCommandRunner()
  const prefix = sanitizeBeadsPrefix(options.prefix ?? basename(options.cwd ?? process.cwd()))
  try {
    const output = await runner.run({
      command,
      args: ['init', '--non-interactive', '--skip-agents', '--skip-hooks', '--prefix', prefix],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    })
    if (output.exitCode !== 0) {
      return {
        ok: false,
        status: 'unhealthy',
        message: 'Beads workspace initialization failed.',
        hint: 'Run bd init --non-interactive --skip-agents --skip-hooks from the project root and inspect the output.',
        details: output.stderr.trim() || output.stdout.trim(),
      }
    }
    try {
      await ensureLegacyBeadsIssuePrefixConfig(options.cwd ?? process.cwd(), prefix)
    } catch (error) {
      return {
        ok: false,
        status: 'unhealthy',
        message: 'Beads workspace initialization created a workspace, but Waypoint could not update Beads compatibility config.',
        hint: 'Inspect .beads/config.yaml and ensure it is writable YAML with the expected Beads issue prefix.',
        details: error instanceof Error ? error.message : String(error),
      }
    }
    return checkWaypointBeadsWorkspace(options)
  } catch (error) {
    if (isMissingCommandError(error)) {
      return {
        ok: false,
        status: 'missing-command',
        message: 'Beads workspace initialization requires the bd CLI, but bd was not found.',
        hint: 'Install Beads or initialize the project with --backend folder.',
        details: error instanceof Error ? error.message : String(error),
      }
    }
    return {
      ok: false,
      status: 'unhealthy',
      message: 'Beads workspace initialization failed before bd returned a result.',
      hint: 'Run bd init --non-interactive --skip-agents --skip-hooks from the project root and inspect the output.',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

export function formatWaypointBeadsWorkspaceReadinessFailure(
  readiness: WaypointBeadsWorkspaceReadiness,
): string {
  if (readiness.ok) return readiness.message
  const details = readiness.details ? ` Details: ${readiness.details}` : ''
  return `${readiness.message} ${readiness.hint}${details}`
}

function readyReadiness(parsed: Record<string, unknown> | null): WaypointBeadsWorkspaceReadiness {
  const path = stringField(parsed, 'path')
  const databasePath = stringField(parsed, 'database_path')
  const prefix = stringField(parsed, 'prefix')
  return {
    ok: true,
    status: 'ready',
    message: 'Beads workspace is ready.',
    hint: 'Waypoint can materialize Beads-backed routes from this project root.',
    ...(path ? { path } : {}),
    ...(databasePath ? { databasePath } : {}),
    ...(prefix ? { prefix } : {}),
  }
}

function failedReadinessFromWhere(
  parsed: Record<string, unknown> | null,
  stderr: string,
): WaypointBeadsWorkspaceReadiness {
  const errorCode = stringField(parsed, 'error')
  const message = stringField(parsed, 'message') || stderr.trim() || 'Beads workspace is not ready.'
  const hint = stringField(parsed, 'hint')
  if (errorCode === 'no_beads_directory') {
    return {
      ok: false,
      status: 'missing-workspace',
      message,
      hint: hint || 'Run waypoint init --backend beads --init-beads, or run bd init from the project root.',
    }
  }
  return {
    ok: false,
    status: 'unhealthy',
    message,
    hint: hint || 'Run bd where --json from the project root to inspect the Beads workspace.',
    ...(stderr.trim() ? { details: stderr.trim() } : {}),
  }
}

function parseOptionalJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function ensureLegacyBeadsIssuePrefixConfig(cwd: string, prefix: string): Promise<void> {
  const configPath = join(cwd, '.beads', 'config.yaml')
  let text: string
  try {
    text = await readFile(configPath, 'utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return
    throw error
  }

  const document = parseDocument(text)
  if (document.errors.length > 0) {
    throw new Error(`Invalid Beads config YAML at ${configPath}: ${document.errors[0]?.message ?? 'parse error'}`)
  }

  const existing = document.get('issue_prefix')
  if (typeof existing === 'string' && existing.trim() !== '') return

  document.set('issue_prefix', prefix)
  await writeFile(configPath, document.toString())
}

function sanitizeBeadsPrefix(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'waypoint'
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingCommandError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
