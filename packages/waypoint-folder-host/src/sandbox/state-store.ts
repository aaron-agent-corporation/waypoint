/**
 * Durable per-project sandbox state for CLI inspect --project-id reconciliation.
 * Used by fake (always) and optionally by cloud providers across process boundaries.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ProjectSandboxState } from './provider.ts'


export function defaultSandboxStateDir(): string {
  const fromEnv = process.env.WAYPOINT_SANDBOX_STATE_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(tmpdir(), 'waypoint-sandbox-state')
}

/**
 * Store key: per-project sprites keep the bare project id (S2 files stay
 * readable); a LANE sprite's state (L5) is keyed per project × lane sprite so
 * two lanes serving one project never clobber each other's evidence.
 */
export function sandboxStateKey(like: {
  readonly project_id: string
  readonly oauth_lane_id?: string
  readonly sandbox_name: string
}): string {
  return like.oauth_lane_id ? `${like.project_id}--${like.sandbox_name}` : like.project_id
}

export function writeSandboxState(state: ProjectSandboxState, root = defaultSandboxStateDir()): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const target = path.join(root, `${sandboxStateKey(state)}.json`)
  const tmp = `${target}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  renameSync(tmp, target)
}

export function readSandboxState(
  projectId: string,
  root = defaultSandboxStateDir(),
): ProjectSandboxState | null {
  const target = path.join(root, `${projectId}.json`)
  if (!existsSync(target)) return null
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as ProjectSandboxState
  } catch {
    return null
  }
}
