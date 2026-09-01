// Host-owned python venv provisioning (rsc-m23, Aaron's directive 2026-07-22):
// the medical-layer pipeline's dependencies are Waypoint's to provision, not an
// operator setup step. The deterministic runtime calls ensurePythonVenv()
// before spawning a python entrypoint; the first dispatch on a machine
// bootstraps <pipeline>/.venv from the vendored pinned requirements.txt
// (host-side, before the seatbelt wrap — the venv lives in the repo checkout,
// which a case jail could never write). Subsequent dispatches see the ready
// marker and return immediately.
//
// The only host prerequisite is a working `python3` with the stdlib venv
// module — everything else is pinned in requirements.txt.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Written only after pip install succeeds, holding the sha256 of the
 * requirements file it installed; a venv without it — or with a marker for
 * DIFFERENT requirements (an upgrade shipped new pins) — is rebuilt.
 */
const READY_MARKER = '.waypoint-ready'
const LOCK_DIR = '.waypoint-venv-lock'
/** How long one process waits on another's in-flight bootstrap. */
const LOCK_WAIT_MS = 10 * 60 * 1000
const LOCK_POLL_MS = 2000

export interface EnsurePythonVenvOptions {
  /** Absolute path the venv lives at (created if absent). */
  readonly venvDir: string
  /** Absolute path to the pinned requirements file to install. */
  readonly requirementsPath: string
  readonly env?: NodeJS.ProcessEnv
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function run(argv: readonly string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, tail }))
  })
}

// One bootstrap per venv per process; concurrent dispatches share the promise.
const inFlight = new Map<string, Promise<string>>()

/**
 * Ensure the venv exists with its requirements installed; returns the venv's
 * python binary path. Throws (with the installer's output tail) when the
 * bootstrap fails — callers surface that as a failed dispatch, never a
 * silent fallback.
 */
export function ensurePythonVenv(options: EnsurePythonVenvOptions): Promise<string> {
  const existing = inFlight.get(options.venvDir)
  if (existing) return existing
  const promise = ensureNow(options).finally(() => inFlight.delete(options.venvDir))
  inFlight.set(options.venvDir, promise)
  return promise
}

async function markerIsCurrent(venvDir: string, wantDigest: string): Promise<boolean> {
  try {
    const marker = await readFile(join(venvDir, READY_MARKER), 'utf8')
    return marker.trim().split('\n')[0] === wantDigest
  } catch {
    return false
  }
}

async function ensureNow(options: EnsurePythonVenvOptions): Promise<string> {
  const python = join(options.venvDir, 'bin', 'python')
  const wantDigest = createHash('sha256').update(await readFile(options.requirementsPath)).digest('hex')
  if (await markerIsCurrent(options.venvDir, wantDigest)) return python

  // Cross-process guard: mkdir is atomic; the loser waits for the winner's
  // ready marker (or the lock to age out) instead of racing pip. The lock's
  // parent must exist first (a brand-new venv home, e.g.
  // ~/.waypoint/tools/extraction, has no directory yet) — otherwise the
  // ENOENT from mkdir masquerades as lock contention.
  await mkdir(join(options.venvDir, '..'), { recursive: true })
  const lockPath = join(options.venvDir, '..', LOCK_DIR)
  try {
    await mkdir(lockPath)
  } catch {
    const deadline = Date.now() + LOCK_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(LOCK_POLL_MS)
      if (await markerIsCurrent(options.venvDir, wantDigest)) return python
      if (!(await pathExists(lockPath))) break // holder finished or died; take over below
    }
    try {
      await mkdir(lockPath)
    } catch {
      throw new Error(`python venv bootstrap: another process holds ${lockPath} and never produced a ready venv`)
    }
  }

  try {
    if (await markerIsCurrent(options.venvDir, wantDigest)) return python
    // A partial or out-of-date venv (crashed bootstrap, changed pins) is rebuilt from scratch.
    if (await pathExists(options.venvDir)) await rm(options.venvDir, { recursive: true, force: true })

    const venv = await run(['python3', '-m', 'venv', options.venvDir], options.env)
    if (venv.code !== 0) {
      throw new Error(`python venv bootstrap: \`python3 -m venv\` exited ${venv.code}: ${venv.tail.trim()}`)
    }
    const pip = await run([python, '-m', 'pip', 'install', '--quiet', '-r', options.requirementsPath], options.env)
    if (pip.code !== 0) {
      throw new Error(`python venv bootstrap: pip install -r ${options.requirementsPath} exited ${pip.code}: ${pip.tail.trim()}`)
    }
    await writeFile(join(options.venvDir, READY_MARKER), `${wantDigest}\n${options.requirementsPath}\n`, 'utf8')
    return python
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}
