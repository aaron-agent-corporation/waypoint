import { spawn } from 'node:child_process'

import { buildLocalRecipePayload } from './payload.ts'

export interface LocalRecipeRuntimeConfig {
  readonly command: string
  readonly args?: readonly string[]
}

export interface LocalRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: string
  readonly prompt: string
  readonly projectRoot: string
}

export type LocalRecipeRuntimeOutputStatus = 'success' | 'failed'

export interface LocalRecipeRuntimeOutput {
  readonly status: LocalRecipeRuntimeOutputStatus
  readonly runtime: 'local'
  readonly recipe: string
  readonly task_id: string
  readonly route_id: string
  readonly exit_code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

export class LocalRecipeRuntime {
  private readonly config: LocalRecipeRuntimeConfig

  constructor(config: LocalRecipeRuntimeConfig) {
    if (config.command.trim() === '') throw new Error('Local runtime command must be non-empty')
    this.config = config
  }

  async runRecipe(input: LocalRecipeRuntimeInput): Promise<LocalRecipeRuntimeOutput> {
    const payload = buildLocalRecipePayload({
      recipeSlug: input.recipe,
      prompt: input.prompt,
      taskId: input.taskId,
      projectRoot: input.projectRoot,
      routeId: input.routeId,
    })
    const result = await runCommand(this.config.command, this.config.args ?? [], JSON.stringify(payload, null, 2))
    return {
      status: result.exitCode === 0 ? 'success' : 'failed',
      runtime: 'local',
      recipe: input.recipe,
      task_id: input.taskId,
      route_id: input.routeId,
      exit_code: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
}

interface CommandResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

function runCommand(command: string, args: readonly string[], stdin: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    child.stdin.on('error', (error) => {
      if (isNodeError(error) && error.code === 'EPIPE') return
      reject(error)
    })
    child.on('error', reject)
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr })
    })
    child.stdin.end(`${stdin}\n`, 'utf8')
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
