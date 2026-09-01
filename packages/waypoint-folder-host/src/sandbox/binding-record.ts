/**
 * The per-project sandbox provisioning record (S1,
 * docs/designs/sprite-worker-isolation.md).
 *
 * Waypoint's sprite is warm-per-project, so the PROVISIONING record lives beside
 * the project config. It is written ONLY by the operator provisioning step
 * (`deploy/sandbox/provision-sprite.ts` calling `provider.create`). Since S2
 * (item 52) the record's job is route START: `sandboxRouteBindingForStart`
 * stamps it onto the durable route row, dispatch admission reads the ROW (so a
 * route runs under the binding it started with), and the file remains the
 * fallback for callers without a durable row (autopilot, dev drivers, pre-S2
 * routes). Every authority-bearing field is re-admitted at dispatch through
 * `projectSandboxBindingFromManagedRoute` — a record is a claim, never a
 * verdict.
 */

import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ManagedRouteSandboxMetadata } from '../runtime/managed-cloud-sandbox.ts'
import type { ProjectSandboxState } from './provider.ts'

/** Where the provisioning record lives, relative to the project root. */
export function sandboxBindingRecordPath(projectRoot: string): string {
  return join(projectRoot, '.waypoint', 'sandbox', 'binding.json')
}

/**
 * Read the provisioning record for dispatch admission. A MISSING record is
 * `undefined` (the project was never provisioned — the jailed branch then
 * refuses with "missing project_id"); a PRESENT-but-unreadable record throws,
 * naming the file — a corrupt provisioning record must fail the attempt
 * loudly, never quietly read as "no sandbox here".
 */
export async function readSandboxBindingRecord(projectRoot: string): Promise<ManagedRouteSandboxMetadata | undefined> {
  const path = sandboxBindingRecordPath(projectRoot)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`sandbox binding record unreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let state: unknown
  try {
    state = JSON.parse(raw)
  } catch (error) {
    throw new Error(`sandbox binding record corrupt: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof state !== 'object' || state === null) {
    throw new Error(`sandbox binding record corrupt: ${path}: not a JSON object`)
  }
  const record = state as Partial<ProjectSandboxState>
  return {
    ...(record.project_id !== undefined ? { project_id: record.project_id } : {}),
    ...(record.provider !== undefined ? { sandbox_provider: record.provider } : {}),
    ...(record.sandbox_instance_id !== undefined ? { sandbox_instance_id: record.sandbox_instance_id } : {}),
    ...(record.image_digest !== undefined ? { sandbox_image: record.image_digest } : {}),
    ...(record.policy_hash !== undefined ? { sandbox_policy: record.policy_hash } : {}),
    ...(record.mount_hash !== undefined ? { sandbox_mount: record.mount_hash } : {}),
    ...(record.generation !== undefined ? { sandbox_generation: record.generation } : {}),
    ...(record.workspace_id !== undefined ? { sandbox_workspace: record.workspace_id } : {}),
  }
}

/**
 * What the record file carries. A FULL record is the provisioned per-project
 * sprite's state; a CONTEXT-ONLY record (L5) omits the sprite fields — workers
 * run on shared OAuth lane sprites realized at dispatch, and route start needs
 * only the project identity + admitted hashes from here.
 */
export type SandboxProvisioningRecord =
  | ProjectSandboxState
  | {
      readonly project_id: string
      readonly project_root: string
      readonly provider: string
      readonly image_digest: string
      readonly policy_hash: string
      readonly mount_hash: string
      readonly workspace_id: string
    }

/** Write the provisioning record (operator provisioning step only). */
export async function writeSandboxBindingRecord(projectRoot: string, state: SandboxProvisioningRecord): Promise<void> {
  const path = sandboxBindingRecordPath(projectRoot)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
