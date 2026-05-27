import { spawn } from 'node:child_process'

import type {
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
  WaypointBeadsIssueCreateResult,
} from './instantiate.ts'
import type { WaypointBeadsDependencySnapshot, WaypointBeadsIssueSnapshot } from './reconstruct.ts'

export interface WaypointBeadsCliIssueClientConfig {
  readonly command?: string
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly globalArgs?: readonly string[]
  readonly runner?: WaypointBeadsCliCommandRunner
}

export interface WaypointBeadsCliCommandInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

export interface WaypointBeadsCliCommandOutput {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

export interface WaypointBeadsCliCommandRunner {
  run(input: WaypointBeadsCliCommandInput): Promise<WaypointBeadsCliCommandOutput>
}

export interface WaypointBeadsIssueSnapshotListResult {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
}

export interface WaypointBeadsIssueSnapshotReader {
  listIssueSnapshots(): Promise<WaypointBeadsIssueSnapshotListResult>
}

export interface WaypointBeadsIssueCommentSnapshot {
  readonly id: string
  readonly issue_id: string
  readonly text: string
  readonly author?: string
  readonly created_at?: string
}

export interface WaypointBeadsIssueCommentReader {
  listIssueComments(issueId: string): Promise<readonly WaypointBeadsIssueCommentSnapshot[]>
}

export interface WaypointBeadsIssueCloseInput {
  readonly id: string
  readonly reason: string
}

export interface WaypointBeadsIssueStatusUpdateInput {
  readonly id: string
  readonly status: string
  readonly note?: string
}

export interface WaypointBeadsIssueCommentInput {
  readonly id: string
  readonly text: string
}

export interface WaypointBeadsIssueMutationClient {
  closeIssue(input: WaypointBeadsIssueCloseInput): Promise<void>
  updateIssueStatus(input: WaypointBeadsIssueStatusUpdateInput): Promise<void>
  addIssueComment(input: WaypointBeadsIssueCommentInput): Promise<void>
}

export class WaypointBeadsCliCommandError extends Error {
  readonly operation: string
  readonly command: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string

  constructor(input: {
    readonly operation: string
    readonly command: string
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
    readonly stdout: string
    readonly stderr: string
  }) {
    const status = input.exitCode === null ? `signal ${input.signal ?? 'unknown'}` : `exit ${input.exitCode}`
    const detail = input.stderr.trim() || input.stdout.trim() || status
    super(`Beads CLI ${input.operation} failed (${status}): ${detail}`)
    this.name = 'WaypointBeadsCliCommandError'
    this.operation = input.operation
    this.command = input.command
    this.exitCode = input.exitCode
    this.signal = input.signal
    this.stdout = input.stdout
    this.stderr = input.stderr
  }
}

export class WaypointBeadsCliIssueClient
  implements WaypointBeadsIssueClient, WaypointBeadsIssueSnapshotReader, WaypointBeadsIssueCommentReader, WaypointBeadsIssueMutationClient
{
  private readonly command: string
  private readonly cwd: string | undefined
  private readonly env: NodeJS.ProcessEnv | undefined
  private readonly globalArgs: readonly string[]
  private readonly runner: WaypointBeadsCliCommandRunner

  constructor(config: WaypointBeadsCliIssueClientConfig = {}) {
    this.command = config.command ?? 'bd'
    this.cwd = config.cwd
    this.env = config.env
    this.globalArgs = config.globalArgs ?? []
    this.runner = config.runner ?? new SpawnWaypointBeadsCliCommandRunner()
  }

  async createIssue(input: WaypointBeadsIssueCreateInput): Promise<WaypointBeadsIssueCreateResult> {
    const args = [
      ...this.globalArgs,
      'create',
      input.title,
      '--description',
      input.description,
      '--type',
      input.issueType,
      '--metadata',
      JSON.stringify(input.metadata),
      '--json',
    ]
    if (input.labels.length > 0) {
      args.push('--labels', input.labels.join(','))
    }
    if (input.parent) {
      args.push('--parent', input.parent)
    }

    const output = await this.run(args, 'create issue')
    const parsed = parseJsonObject(output.stdout, 'create issue')
    const id = parsed.id
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('Beads CLI create issue response did not return an issue id')
    }
    return { id }
  }

  async addDependency(input: WaypointBeadsDependencyCreateInput): Promise<void> {
    await this.run(
      [...this.globalArgs, 'dep', 'add', input.dependent, input.dependency, '--type', input.type, '--json'],
      'add dependency',
    )
  }

  async listIssueSnapshots(): Promise<WaypointBeadsIssueSnapshotListResult> {
    const output = await this.run([...this.globalArgs, 'list', '--all', '--label', 'waypoint', '--json', '--limit', '0'], 'list issues')
    const issues = parseJsonArray(output.stdout, 'list issues')
      .map((entry) => issueSnapshotFromBeadsListEntry(entry))
      .filter((entry): entry is WaypointBeadsIssueSnapshot => Boolean(entry))
    return {
      issues,
      dependencies: dependenciesFromIssueSnapshots(issues),
    }
  }

  async listIssueComments(issueId: string): Promise<readonly WaypointBeadsIssueCommentSnapshot[]> {
    const output = await this.run([...this.globalArgs, 'comments', issueId, '--json'], 'list issue comments')
    return parseJsonArray(output.stdout, 'list issue comments')
      .map((entry, index) => commentSnapshotFromBeadsCommentEntry(entry, issueId, index))
      .filter(isPresent)
  }

  async closeIssue(input: WaypointBeadsIssueCloseInput): Promise<void> {
    await this.run([...this.globalArgs, 'close', input.id, '--reason', input.reason, '--json'], 'close issue')
  }

  async updateIssueStatus(input: WaypointBeadsIssueStatusUpdateInput): Promise<void> {
    const args = [...this.globalArgs, 'update', input.id, '--status', input.status, '--json']
    if (input.note) args.push('--append-notes', input.note)
    await this.run(args, 'update issue status')
  }

  async addIssueComment(input: WaypointBeadsIssueCommentInput): Promise<void> {
    await this.run([...this.globalArgs, 'comment', input.id, input.text, '--json'], 'comment issue')
  }

  private async run(args: readonly string[], operation: string): Promise<WaypointBeadsCliCommandOutput> {
    const output = await this.runner.run({
      command: this.command,
      args,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
    })
    if (output.exitCode !== 0) {
      throw new WaypointBeadsCliCommandError({
        operation,
        command: formatCommand(this.command, args),
        exitCode: output.exitCode,
        signal: output.signal,
        stdout: output.stdout,
        stderr: output.stderr,
      })
    }
    return output
  }
}

export class SpawnWaypointBeadsCliCommandRunner implements WaypointBeadsCliCommandRunner {
  run(input: WaypointBeadsCliCommandInput): Promise<WaypointBeadsCliCommandOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (exitCode, signal) => {
        resolve({ exitCode, signal, stdout, stderr })
      })
    })
  }
}

function parseJsonObject(stdout: string, operation: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    throw new Error(`Beads CLI ${operation} did not return JSON output`)
  }
  const parsed: unknown = JSON.parse(trimmed)
  if (!isRecord(parsed)) {
    throw new Error(`Beads CLI ${operation} returned non-object JSON output`)
  }
  return parsed
}

function parseJsonArray(stdout: string, operation: string): readonly unknown[] {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    throw new Error(`Beads CLI ${operation} did not return JSON output`)
  }
  const parsed: unknown = JSON.parse(trimmed)
  if (!Array.isArray(parsed)) {
    throw new Error(`Beads CLI ${operation} returned non-array JSON output`)
  }
  return parsed
}

function issueSnapshotFromBeadsListEntry(entry: unknown): WaypointBeadsIssueSnapshot | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') return null
  const status = typeof entry.status === 'string' ? entry.status : 'open'
  const issueType = typeof entry.issue_type === 'string' ? entry.issue_type : undefined
  const createdAt = typeof entry.created_at === 'string' ? entry.created_at : undefined
  const updatedAt = typeof entry.updated_at === 'string' ? entry.updated_at : undefined
  const parent = typeof entry.parent === 'string' ? entry.parent : undefined
  const dependencies = Array.isArray(entry.dependencies)
    ? entry.dependencies.map((dependency) => dependencySnapshotFromBeadsListEntry(dependency)).filter(isPresent)
    : undefined
  return {
    id: entry.id,
    title: entry.title,
    status,
    ...(issueType ? { issue_type: issueType } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    ...(parent ? { parent } : {}),
    ...(dependencies ? { dependencies } : {}),
  }
}

function dependencySnapshotFromBeadsListEntry(entry: unknown): WaypointBeadsDependencySnapshot | null {
  if (!isRecord(entry) || typeof entry.issue_id !== 'string' || typeof entry.depends_on_id !== 'string') return null
  return {
    issue_id: entry.issue_id,
    depends_on_id: entry.depends_on_id,
    ...(typeof entry.type === 'string' ? { type: entry.type } : {}),
  }
}

function dependenciesFromIssueSnapshots(issues: readonly WaypointBeadsIssueSnapshot[]): readonly WaypointBeadsDependencySnapshot[] {
  return issues.flatMap((issue) =>
    (issue.dependencies ?? [])
      .map((dependency): WaypointBeadsDependencySnapshot | null => {
        const issueId = dependency.issue_id ?? issue.id
        const dependsOnId = dependency.depends_on_id ?? dependency.id
        if (!dependsOnId) return null
        return {
          issue_id: issueId,
          depends_on_id: dependsOnId,
          ...(dependency.type ? { type: dependency.type } : {}),
        }
      })
      .filter(isPresent),
  )
}

function commentSnapshotFromBeadsCommentEntry(
  entry: unknown,
  issueId: string,
  index: number,
): WaypointBeadsIssueCommentSnapshot | null {
  if (!isRecord(entry)) return null
  const text = firstString(entry.text, entry.body, entry.content, entry.comment, entry.message)
  if (!text) return null
  const id = firstString(entry.id, entry.comment_id) ?? `comment-${String(index + 1).padStart(3, '0')}`
  const entryIssueId = firstString(entry.issue_id, entry.issueId) ?? issueId
  const author = firstString(entry.author, entry.actor, entry.user)
  const createdAt = firstString(entry.created_at, entry.createdAt, entry.timestamp)
  return {
    id,
    issue_id: entryIssueId,
    text,
    ...(author ? { author } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  }
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function formatCommand(command: string, args: readonly string[]): string {
  const renderedArgs = args.map((arg, index) => (shouldRedactArg(args[index - 1]) ? '[redacted]' : arg))
  return [command, ...renderedArgs].join(' ')
}

function shouldRedactArg(previousArg: string | undefined): boolean {
  return previousArg === '--description' || previousArg === '--metadata'
}
