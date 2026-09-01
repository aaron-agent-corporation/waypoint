import { spawn } from 'node:child_process'

/**
 * The lean worker-spawn primitive: spawn an argv (cwd = project root, work order
 * on stdin) in its own process group so abort and budget expiry kill the whole
 * tree, then resolve with the captured exit/streams. This is the SINGLE spawn
 * seam every worker path shares — the `claude -p` worker (worker-runtime.ts),
 * the deterministic entrypoints (deterministic-runtime.ts), and the jailed pi
 * worker (pi-jailed-runtime.ts) all call {@link runWorkerCommand}.
 *
 * It lives in its own module (rather than inside worker-runtime.ts) on purpose:
 * worker-runtime.ts imports `artifact-contracts.ts`, which pulls the CLI tool
 * entrypoints (medical-layer-seed, assemble-referral-package) whose module-eval
 * `main()` self-exec guards mis-fire when the pi worker child is esbuild-bundled
 * for the microVM. Keeping the spawn primitive here — with no artifact/tool
 * imports — lets the pi child depend on the spawn machinery without dragging the
 * whole worker-runtime graph (and its stray mains) into the bundle.
 */

const KILL_GRACE_MS = 2000

/**
 * Questions a worker can ask that nobody is there to answer.
 *
 * Deliberately narrow — the cost of a false match is killing real work — and
 * every one of these is a CLI stopping for interactive consent, never wording
 * an agent would produce while doing the task. A worker blocked on one of them
 * makes no further progress: the only outcomes are this kill or the full
 * budget.
 */
const UNANSWERABLE_PROMPTS: readonly RegExp[] = [
  /opening authentication page in your browser/i,
  /\bdo you want to continue\?\s*\[y\/n\]/i,
  /press enter to continue/i,
  /waiting for (?:you to )?(?:authenticate|sign in|log in)/i,
]

export interface WorkerCommandResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  /** Set when the worker was killed for asking a question nobody can answer. */
  readonly blockedPrompt?: string
  readonly stderr: string
  readonly aborted: boolean
  readonly timedOut: boolean
}

/**
 * Spawn the agent argv (cwd = project root, work order on stdin) in its own
 * process group so abort and budget expiry kill the whole tree the agent
 * spawns, not just the leader (SIGTERM, then SIGKILL after a grace period —
 * the local-runtime salvage, plus the budget deadline).
 *
 * `env` replaces the inherited environment when given. The sandboxed path MUST
 * pass the same environment it validated: microsandbox resolves `--secret
 * ENV@HOST` against ITS OWN process env, so validating one environment and
 * spawning with another means we can pass admission and still hand msb a
 * reference it cannot resolve. Caught live (rsc-wxk) — the unit suite could not
 * see it, because a fake msb never resolves the reference. Passing the full host
 * env to msb is not a leak: msb is the broker and runs host-side, and the GUEST
 * env is clean by default (measured: no wholesale inheritance).
 */
export function runWorkerCommand(
  argv: readonly string[],
  stdin: string,
  cwd: string,
  budgetMs: number,
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
): Promise<WorkerCommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({ exitCode: null, signal: null, stdout: '', stderr: '', aborted: true, timedOut: false })
      return
    }
    const [command, ...args] = argv
    const child = spawn(command!, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true, ...(env ? { env } : {}) })
    let stdout = ''
    let stderr = ''
    let aborted = false
    let timedOut = false
    let blockedPrompt: string | null = null
    let killTimer: NodeJS.Timeout | null = null

    const killGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, sig)
      } catch {
        // Group already gone (race with natural exit) — nothing to escalate.
      }
    }
    const stopGroup = (): void => {
      killGroup('SIGTERM')
      killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS)
      killTimer.unref?.()
    }

    const onAbort = (): void => {
      aborted = true
      stopGroup()
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const deadline = setTimeout(() => {
      timedOut = true
      stopGroup()
    }, budgetMs)
    deadline.unref?.()

    const cleanup = (): void => {
      clearTimeout(deadline)
      if (killTimer) clearTimeout(killTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    // A worker that stops to ask a human something will never be answered:
    // there is nobody at this stdin. The gemini lane printed "Opening
    // authentication page in your browser. Do you want to continue? [Y/n]:"
    // and then held one intake dispatch for its entire 180-minute budget
    // before reporting `exhausted` (2026-08-20). Kill it on the question; the
    // prompt stays in the captured output, where the lane-health check reads
    // it as an account problem and hands the work to another lane.
    const cutShortOnPrompt = (text: string): void => {
      if (blockedPrompt !== null) return
      for (const pattern of UNANSWERABLE_PROMPTS) {
        const match = pattern.exec(text)
        if (!match) continue
        blockedPrompt = match[0]
        stopGroup()
        return
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      cutShortOnPrompt(stdout)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      cutShortOnPrompt(stderr)
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
      resolve({ exitCode, signal: closeSignal, stdout, stderr, aborted, timedOut,
        ...(blockedPrompt === null ? {} : { blockedPrompt }) })
    })
    child.stdin.end(stdin, 'utf8')
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
