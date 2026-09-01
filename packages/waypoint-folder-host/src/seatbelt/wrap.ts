import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

/**
 * sandbox-exec launch helpers for the Seatbelt write jail (P3/W2, port of
 * Crew's `internal/seatbelt` wrap.go). The subprocess-first worker host wraps
 * argv directly (`seatbeltWrapArgv`); the `sh -c` shape is kept for shell
 * commands. The Go version's tmux-oriented single-string WrapShell has no TS
 * consumer and was not ported (documented divergence).
 */

/**
 * The macOS Seatbelt launcher binary, by ABSOLUTE path.
 *
 * This is the write jail's own launcher, so it must not be resolved through
 * the caller's PATH: a spawn env without PATH cannot find it at all, and a
 * PATH carrying an earlier `sandbox-exec` would silently run the worker
 * unconfined while every surface still reported it jailed. /usr/bin is the
 * system location and is SIP-protected; a host that lacks it fails the probe
 * below, and the jail refuses to spawn rather than dropping the boundary.
 */
const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

/** Bounds the one-time availability probe. */
const PROBE_TIMEOUT_MS = 5000

const execFileAsync = promisify(execFile)

/**
 * Throws unless sandbox-exec is present and runnable on this host. Runs a
 * no-op command under a permissive throwaway profile; returning means the
 * launcher works and wrapping is safe.
 */
export async function seatbeltAvailable(): Promise<void> {
  try {
    await execFileAsync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', 'true'], { timeout: PROBE_TIMEOUT_MS })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`seatbelt: ${SANDBOX_EXEC} probe failed: ${detail}`)
  }
}

/**
 * The argv that runs shellCommand under the SBPL profile at profilePath:
 *
 *   /usr/bin/sandbox-exec -f <profilePath> sh -c <shellCommand>
 *
 * The whole process tree launched by shellCommand inherits the jail, so a
 * bash sub-shell or spawned child cannot escape it (the spike's load-bearing
 * probe P2).
 */
export function seatbeltCommand(profilePath: string, shellCommand: string): string[] {
  return [SANDBOX_EXEC, '-f', profilePath, 'sh', '-c', shellCommand]
}

/**
 * The argv that runs an existing argv under the SBPL profile at profilePath —
 * the shape the subprocess-first worker runtime spawns (no shell in between):
 *
 *   /usr/bin/sandbox-exec -f <profilePath> <argv...>
 */
export function seatbeltWrapArgv(profilePath: string, argv: readonly string[]): string[] {
  return [SANDBOX_EXEC, '-f', profilePath, ...argv]
}

/**
 * Atomically write profile to "<name>.sb" under dir and return the file path
 * (temp file + rename, per the repo's atomic-write convention). dir must
 * already exist and should be a directory the worker cannot write to, so a
 * jailed process cannot rewrite its own profile.
 */
export async function writeSeatbeltProfile(dir: string, name: string, profile: string): Promise<string> {
  const dest = path.join(dir, `${name}.sb`)
  const tmp = path.join(dir, `${name}.sb.${randomBytes(6).toString('hex')}`)
  try {
    await writeFile(tmp, profile, 'utf8')
    await rename(tmp, dest)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`seatbelt: installing profile ${dest}: ${detail}`)
  }
  return dest
}
