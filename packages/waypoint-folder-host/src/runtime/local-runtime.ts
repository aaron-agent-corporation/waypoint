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
  readonly signal?: AbortSignal
}

export type LocalRecipeRuntimeOutputStatus = 'success' | 'failed' | 'cancelled'

/** Grace period between SIGTERM and the SIGKILL escalation when aborting a child. */
const ABORT_GRACE_MS = 2000

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
    const result = await runCommand(this.config.command, this.config.args ?? [], JSON.stringify(payload, null, 2), input.signal)
    return {
      status: result.aborted ? 'cancelled' : result.exitCode === 0 ? 'success' : 'failed',
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
  readonly aborted: boolean
}

function runCommand(command: string, args: readonly string[], stdin: string, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ exitCode: null, signal: null, stdout: '', stderr: '', aborted: true })
      return
    }

    // When an abort signal is in play, `detached` puts the child in its own
    // process group so abort can SIGTERM/SIGKILL the whole group (children the
    // recipe spawns), not just the leader. Without a signal we keep the prior
    // (non-detached) behavior so existing recipe runs are unaffected.
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], detached: Boolean(signal) })
    let stdout = ''
    let stderr = ''
    let aborted = false
    let killTimer: NodeJS.Timeout | null = null

    const killGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, sig)
      } catch {
        // Group already gone (race with natural exit) — nothing to escalate.
      }
    }

    const onAbort = (): void => {
      aborted = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => killGroup('SIGKILL'), ABORT_GRACE_MS)
      killTimer.unref?.()
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

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
      cleanup()
      reject(error)
    })
    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('close', (exitCode, closeSignal) => {
      cleanup()
      resolve({ exitCode, signal: closeSignal, stdout, stderr, aborted })
    })
    child.stdin.end(`${stdin}\n`, 'utf8')
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
