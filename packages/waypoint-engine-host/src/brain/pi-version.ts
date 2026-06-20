import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

/**
 * Pinned `pi` CLI version range (Spike 1 captured fixtures against 0.55.3). The
 * adapter + decoder are validated against this range; a `pi` outside it is
 * surfaced (Task 9 fail-loud selection), never silently driven.
 */
export const PI_PINNED_RANGE = '0.55.x'

const PINNED_PREFIX = '0.55.'

/** Injectable spawn for tests; defaults to the real `spawnSync`. */
export type VersionProbe = (
  command: string,
  args: readonly string[],
  options: { encoding: 'utf8' },
) => SpawnSyncReturns<string>

const defaultProbe: VersionProbe = (command, args, options) => spawnSync(command, [...args], options)

/** True when a `pi` binary is on PATH and answers `--version`. */
export function piAvailable(probe: VersionProbe = defaultProbe): boolean {
  try {
    return probe('pi', ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

/** Resolve the installed `pi` version and whether it satisfies {@link PI_PINNED_RANGE}. */
export function piVersionOk(probe: VersionProbe = defaultProbe): { ok: boolean; version: string | null } {
  let result: SpawnSyncReturns<string>
  try {
    result = probe('pi', ['--version'], { encoding: 'utf8' })
  } catch {
    return { ok: false, version: null }
  }
  if (result.status !== 0) return { ok: false, version: null }
  const version = parsePiVersion(result.stdout)
  return { ok: version !== null && version.startsWith(PINNED_PREFIX), version }
}

function parsePiVersion(stdout: unknown): string | null {
  if (typeof stdout !== 'string') return null
  const match = /(\d+\.\d+\.\d+)/.exec(stdout)
  return match ? match[1] : null
}
