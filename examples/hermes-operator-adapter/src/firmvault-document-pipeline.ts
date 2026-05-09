import { spawn } from 'node:child_process'
import { extname, isAbsolute } from 'node:path'

export type FirmVaultDocumentPipelineStatus = 'submitted' | 'pr_opened' | 'failed'
export type FirmVaultDocumentPipelineWorkflow = 'forgejo'

export interface FirmVaultDocumentPipelineRequest {
  readonly pipelineRepoPath: string
  readonly sourcePdf: string
  readonly workflow?: FirmVaultDocumentPipelineWorkflow
  readonly dryRun?: boolean
}

export interface FirmVaultDocumentPipelineSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

export interface FirmVaultDocumentPipelineRawResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type FirmVaultDocumentPipelineExecutor = (
  spec: FirmVaultDocumentPipelineSpec,
) => Promise<FirmVaultDocumentPipelineRawResult>

export interface FirmVaultDocumentPipelineOptions {
  readonly executor?: FirmVaultDocumentPipelineExecutor
}

export interface FirmVaultDocumentPipelineResult {
  readonly ok: boolean
  readonly status: FirmVaultDocumentPipelineStatus
  readonly pipelineRepoPath: string
  readonly sourcePdf: string
  readonly branch: string | null
  readonly prUrl: string | null
  readonly prNumber: number | null
  readonly segmentsCommitted: number
  readonly segmentsParked: number
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

interface PipelineJsonSummary {
  readonly branch_name?: unknown
  readonly pr_url?: unknown
  readonly pr_number?: unknown
  readonly segments_committed?: unknown
  readonly segments_parked?: unknown
}

export async function runFirmVaultDocumentPipelineWithHermesOperator(
  request: FirmVaultDocumentPipelineRequest,
  options: FirmVaultDocumentPipelineOptions = {},
): Promise<FirmVaultDocumentPipelineResult> {
  validatePipelineRequest(request)
  const workflow = request.workflow ?? 'forgejo'
  const spec: FirmVaultDocumentPipelineSpec = {
    command: 'uv',
    args: [
      'run',
      'firmvault_ingest_once',
      'ingest',
      request.sourcePdf,
      '--workflow',
      workflow,
      ...(request.dryRun ? ['--dry-run'] : []),
    ],
    cwd: request.pipelineRepoPath,
  }
  const executor = options.executor ?? executePipelineCommand
  const raw = await executor(spec)
  const stdout = redactSecrets(raw.stdout)
  const stderr = redactSecrets(raw.stderr)
  const parsed = parsePipelineJson(stdout)
  const branch = optionalStringJsonField(parsed?.branch_name)
  const prUrl = optionalStringJsonField(parsed?.pr_url)
  const prNumber = optionalNumberJsonField(parsed?.pr_number)
  const segmentsCommitted = optionalNumberJsonField(parsed?.segments_committed) ?? 0
  const segmentsParked = optionalNumberJsonField(parsed?.segments_parked) ?? 0
  const ok = raw.exitCode === 0
  const status: FirmVaultDocumentPipelineStatus = ok
    ? prUrl || prNumber !== null ? 'pr_opened' : 'submitted'
    : 'failed'

  return {
    ok,
    status,
    pipelineRepoPath: request.pipelineRepoPath,
    sourcePdf: request.sourcePdf,
    branch,
    prUrl,
    prNumber,
    segmentsCommitted,
    segmentsParked,
    stdout,
    stderr,
    summary: buildSummary({
      ok,
      status,
      sourcePdf: request.sourcePdf,
      branch,
      prNumber,
      prUrl,
    }),
  }
}

async function executePipelineCommand(
  spec: FirmVaultDocumentPipelineSpec,
): Promise<FirmVaultDocumentPipelineRawResult> {
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

function validatePipelineRequest(request: FirmVaultDocumentPipelineRequest): void {
  if (!isAbsolute(request.pipelineRepoPath)) {
    throw new Error('FirmVault document pipeline repo path must be absolute')
  }
  if (!isAbsolute(request.sourcePdf)) {
    throw new Error('FirmVault document pipeline source PDF must be an absolute path')
  }
  if (extname(request.sourcePdf).toLowerCase() !== '.pdf') {
    throw new Error('FirmVault document pipeline source must be a PDF')
  }
  if (request.workflow !== undefined && request.workflow !== 'forgejo') {
    throw new Error(`FirmVault document pipeline adapter only supports workflow forgejo: ${request.workflow}`)
  }
}

function parsePipelineJson(stdout: string): PipelineJsonSummary | null {
  if (stdout.trim() === '') return null
  try {
    const parsed = JSON.parse(stdout) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function optionalStringJsonField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function optionalNumberJsonField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildSummary(input: {
  readonly ok: boolean
  readonly status: FirmVaultDocumentPipelineStatus
  readonly sourcePdf: string
  readonly branch: string | null
  readonly prNumber: number | null
  readonly prUrl: string | null
}): string {
  if (!input.ok) {
    return `FirmVault document pipeline failed for ${input.sourcePdf}.`
  }
  if (input.status === 'pr_opened') {
    const prLabel = input.prNumber === null ? input.prUrl ?? 'unknown PR' : `PR #${input.prNumber}`
    const branchLabel = input.branch ?? 'unknown branch'
    return `FirmVault document pipeline opened ${prLabel} for ${input.sourcePdf} on ${branchLabel}.`
  }
  const branchLabel = input.branch ?? 'a staged branch'
  return `FirmVault document pipeline staged ${input.sourcePdf} on ${branchLabel}.`
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(FORGEJO_API_TOKEN|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)=([^\s"'\\]+)/g, '$1=[REDACTED]')
    .replace(/\b(Authorization:\s*Bearer\s+)([^\s"'\\]+)/gi, '$1[REDACTED]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9][A-Za-z0-9_-]{10,})\b/g, '[REDACTED]')
    .replace(/\b(sk-or-v1-[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
