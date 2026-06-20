import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

import { extractBrainResult, PiStreamDecoder, type BrainResultDraft } from './pi-stream-decoder.ts'
import type { BrainAdapter, BrainEvent, BrainResult, BrainRunInput } from './brain-adapter.ts'

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface PiCliBrainAdapterOptions {
  /** Loopback engine-host URL the Pi child calls back into. */
  readonly hostUrl: string
  /** The per-session SCOPED token (never the host token — MAR Contract Lock 1). */
  readonly hostToken: string
  /** Path to the Waypoint Pi extension that registers the granted tools (Task 8). */
  readonly extensionPath: string
  readonly piBin?: string
  readonly spawnFn?: SpawnFn
  /** Delay between SIGTERM and the SIGKILL escalation on abort. */
  readonly killGraceMs?: number
  readonly now?: () => string
  readonly env?: NodeJS.ProcessEnv
}

const DEFAULT_KILL_GRACE_MS = 2000
const STDERR_TAIL_LIMIT = 2000

/**
 * Build the `pi` argv. `--no-tools -e <ext>` scopes the agent to ONLY the
 * Waypoint extension tools (Spike 1 / Lock 9); `--mode json` is pinned for the
 * decoder. The system prompt is passed via `--system`; the intent is the
 * trailing positional prompt.
 */
export function buildPiArgs(input: { intent: string; systemPrompt: string; extensionPath: string }): string[] {
  return ['-p', '--mode', 'json', '--no-tools', '-e', input.extensionPath, '--system', input.systemPrompt, input.intent]
}

/**
 * Drives the `pi` coding agent as a headless child process (no in-process SDK).
 * Streams normalized `BrainEvent`s via the buffered decoder, captures a stderr
 * tail, and maps process exit → `BrainResult`. Abort escalates SIGTERM→SIGKILL.
 */
export class PiCliBrainAdapter implements BrainAdapter {
  private readonly hostUrl: string
  private readonly hostToken: string
  private readonly extensionPath: string
  private readonly piBin: string
  private readonly spawnFn: SpawnFn
  private readonly killGraceMs: number
  private readonly now: () => string
  private readonly env: NodeJS.ProcessEnv

  constructor(options: PiCliBrainAdapterOptions) {
    this.hostUrl = options.hostUrl
    this.hostToken = options.hostToken
    this.extensionPath = options.extensionPath
    this.piBin = options.piBin ?? 'pi'
    this.spawnFn = options.spawnFn ?? (spawn as SpawnFn)
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    this.now = options.now ?? (() => new Date().toISOString())
    this.env = options.env ?? process.env
  }

  runSession(input: BrainRunInput): Promise<BrainResult> {
    return new Promise((resolve) => {
      if (input.signal?.aborted) {
        resolve({ status: 'cancelled' })
        return
      }

      const decoder = new PiStreamDecoder({ now: this.now })
      const events: BrainEvent[] = []
      let stderrTail = ''
      let aborted = false
      let settled = false
      let killTimer: ReturnType<typeof setTimeout> | null = null

      const args = buildPiArgs({ intent: input.intent, systemPrompt: input.systemPrompt, extensionPath: this.extensionPath })
      const child = this.spawnFn(this.piBin, args, {
        // stdin IGNORED is load-bearing: `pi -p -e <ext>` blocks on an open stdin (Spike 1).
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...this.env, WAYPOINT_HOST_URL: this.hostUrl, WAYPOINT_HOST_TOKEN: this.hostToken },
      })

      const onAbort = (): void => {
        aborted = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs)
        killTimer.unref?.()
      }
      if (input.signal) input.signal.addEventListener('abort', onAbort, { once: true })

      const cleanup = (): void => {
        if (killTimer) clearTimeout(killTimer)
        if (input.signal) input.signal.removeEventListener('abort', onAbort)
      }

      const emit = (event: BrainEvent): void => {
        events.push(event)
        input.onEvent(event)
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        for (const event of decoder.push(chunk)) emit(event)
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT)
      })

      child.on('error', (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status: 'error', error: joinTail(error.message, stderrTail) })
      })

      child.on('close', (code: number | null) => {
        if (settled) return
        settled = true
        cleanup()
        for (const event of decoder.flush()) emit(event)

        if (aborted) {
          resolve({ status: 'cancelled' })
          return
        }
        const draft = extractBrainResult(events)
        if (code === 0 || draft.status === 'completed') {
          resolve(draftToResult(draft))
          return
        }
        resolve({ status: 'error', error: stderrTail.trim() || `pi exited with code ${code ?? 'null'}` })
      })
    })
  }
}

function draftToResult(draft: BrainResultDraft): BrainResult {
  return {
    status: draft.status,
    ...(draft.summary !== undefined ? { summary: draft.summary } : {}),
    ...(draft.proposalId !== undefined ? { proposalId: draft.proposalId } : {}),
    ...(draft.adhocRouteId !== undefined ? { adhocRouteId: draft.adhocRouteId } : {}),
    ...(draft.error !== undefined ? { error: draft.error } : {}),
  }
}

function joinTail(message: string, stderrTail: string): string {
  return stderrTail.trim() ? `${message}\n${stderrTail.trim()}` : message
}
