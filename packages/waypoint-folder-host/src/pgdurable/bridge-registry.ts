import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isDurablePostgresRouteBackend, resolvePostgresBackend } from '../project/backend.ts'

/**
 * The bridge registry (A-track, docs/designs/a-autopilot-retirement.md): how
 * the Console's bridge supervisor learns which project roots need a
 * `waypoint bridge`. One JSON record per durable project, keyed by the sha256
 * of the realpath'd root (the CLI daemons-registry precedent). The Node side
 * only ever REGISTERS — spawning and supervision are the Console's.
 *
 * Registration happens when a durable route starts (a bridge is only needed
 * once routes exist); it is best-effort by design — a registry IO failure
 * must never fail the route start it rides on.
 */

export interface BridgeRegistryRecord {
  readonly project_root: string
  readonly schema: string
  readonly registered_at: string
}

/** `~/.waypoint/bridges` (WAYPOINT_CONFIG_HOME honored, as the
 * Console's runner entry honors it for the global config). */
export function bridgeRegistryDir(): string {
  const home = process.env.WAYPOINT_CONFIG_HOME?.trim()
  return join(home !== undefined && home !== '' ? home : join(homedir(), '.waypoint'), 'bridges')
}

export function bridgeRegistryRecordPath(projectRoot: string): string {
  return join(bridgeRegistryDir(), `${canonicalProjectDigest(projectRoot)}.json`)
}

/** Canonical host project identity: SHA-256 of the real project-root path. */
export function canonicalProjectDigest(projectRoot: string): string {
  return createHash('sha256').update(toRealpath(projectRoot), 'utf8').digest('hex')
}

/**
 * Record that `projectRoot` is a durable project whose routes need a bridge.
 * No-op on non-durable projects; never throws (best-effort seam).
 */
export async function registerBridgeProject(projectRoot: string): Promise<void> {
  try {
    if (!(await isDurablePostgresRouteBackend(projectRoot))) return
    const realRoot = toRealpath(projectRoot)
    const resolved = await resolvePostgresBackend(projectRoot)
    const record: BridgeRegistryRecord = {
      project_root: realRoot,
      schema: resolved.schema,
      registered_at: new Date().toISOString(),
    }
    await mkdir(bridgeRegistryDir(), { recursive: true })
    await writeFile(bridgeRegistryRecordPath(realRoot), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  } catch {
    // Best-effort: the Console's periodic rescan and session-touch fast path
    // can still discover the project; a route start must not fail here.
  }
}

/** Read one registry record; null when absent or unreadable. */
export async function readBridgeRegistryRecord(projectRoot: string): Promise<BridgeRegistryRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(bridgeRegistryRecordPath(projectRoot), 'utf8')) as Partial<BridgeRegistryRecord>
    if (typeof parsed.project_root !== 'string' || typeof parsed.schema !== 'string') return null
    return { project_root: parsed.project_root, schema: parsed.schema, registered_at: String(parsed.registered_at ?? '') }
  } catch {
    return null
  }
}

/** The macOS /var symlink lesson (P5): registry keys derive from the REAL
 * path, or the Console and a spawned CLI disagree about the same project. */
function toRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
