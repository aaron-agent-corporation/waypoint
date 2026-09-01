import { spawn } from 'node:child_process'
import { PassThrough, type Readable } from 'node:stream'

/** Host paths excluded from sprite sync — worker can reinstall or fetch as needed. */
export const MANAGED_WORKSPACE_TAR_EXCLUDES = [
  'node_modules',
  '.git/objects',
  '.git/modules',
  'lat.md/.cache',
  'tests/fixtures/models',
] as const

/**
 * A consumer must be attached to the child's stdout SYNCHRONOUSLY: Node
 * resumes and DISCARDS unread stdio the moment the child exits (it must drain
 * to emit 'close'), so a small tar that finishes during the caller's async
 * setup (policy POST, WebSocket connect) would otherwise deliver zero bytes —
 * while a large tree blocks on the pipe and survives. Size-dependent data
 * loss; see docs/ERRORS-AND-FIXES.md (2026-08-28).
 */
function bufferedStdout(stdout: Readable): Readable {
  const buffered = new PassThrough()
  stdout.on('error', (error) => buffered.destroy(error))
  stdout.pipe(buffered)
  return buffered
}

/** Spawn `tar -cf -` on the host for streaming into the guest extractor. */
export function createHostProjectTarStream(
  projectRoot: string,
  excludes: readonly string[] = MANAGED_WORKSPACE_TAR_EXCLUDES,
): { readonly stdout: Readable; readonly done: Promise<number> } {
  const args = ['-C', projectRoot, '-cf', '-', ...excludes.flatMap((pattern) => ['--exclude', pattern]), '.']
  const tar = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const stderrChunks: Buffer[] = []
  tar.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  const done = new Promise<number>((resolve, reject) => {
    tar.on('error', reject)
    tar.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`host tar refused workspace sync: ${Buffer.concat(stderrChunks).toString('utf8').trim()}`))
        return
      }
      resolve(code ?? 0)
    })
  })
  if (!tar.stdout) throw new Error('host tar refused workspace sync: stdout pipe missing')
  return { stdout: bufferedStdout(tar.stdout), done }
}

/** Host paths excluded from arbitrary-dir sync (L4 trim: the live codex home
 *  also carries log/ and tmp/ — nothing bulky or stateful ever rides a dispatch). */
export const MANAGED_CREDENTIAL_TAR_EXCLUDES = ['browser', 'cache', 'backups', 'sessions', 'projects', 'log', 'tmp'] as const

/** Spawn `tar -cf -` for an arbitrary host directory (credential homes, etc.). */
export function createHostDirTarStream(
  hostDir: string,
  excludes: readonly string[] = MANAGED_CREDENTIAL_TAR_EXCLUDES,
): { readonly stdout: Readable; readonly done: Promise<number> } {
  const args = [
    '-C',
    hostDir,
    '-cf',
    '-',
    ...excludes.flatMap((pattern) => ['--exclude', pattern]),
    '.',
  ]
  const tar = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const stderrChunks: Buffer[] = []
  tar.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  const done = new Promise<number>((resolve, reject) => {
    tar.on('error', reject)
    tar.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`host tar refused dir sync: ${Buffer.concat(stderrChunks).toString('utf8').trim()}`))
        return
      }
      resolve(code ?? 0)
    })
  })
  if (!tar.stdout) throw new Error('host tar refused dir sync: stdout pipe missing')
  return { stdout: bufferedStdout(tar.stdout), done }
}
