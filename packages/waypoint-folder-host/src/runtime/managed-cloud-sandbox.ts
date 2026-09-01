import { createHash } from 'node:crypto'
import path from 'node:path'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { isProductionSandboxBackend } from '../project/config.ts'
import {
  createCloudProjectSandboxProvider,
  createProjectSandboxProvider,
  type CloudSandboxProviderKind,
} from '../sandbox/providers/cloud.ts'
import {
  canonicalizeSandboxEgressAllowlist,
  stableProjectSandboxName,
  type ProjectSandboxBinding,
  type ProjectSandboxProvider,
  type ProjectSandboxState,
} from '../sandbox/provider.ts'
import type { WorkerRecipeRuntimeConfig } from './worker-runtime.ts'

/** Route / admission metadata carried on managed worker dispatches. */
export interface ManagedRouteSandboxMetadata {
  readonly project_id?: string
  readonly manager_session_id?: string
  readonly sandbox_provider?: string
  readonly sandbox_instance_id?: string
  readonly sandbox_image?: string
  readonly sandbox_policy?: string
  readonly sandbox_mount?: string
  readonly sandbox_generation?: number
  readonly sandbox_workspace?: string
  readonly workspace_lease_id?: string
}

function requireManagedString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`managed sandbox binding refused: missing ${label}`)
  }
  return value.trim()
}

/**
 * Build the admitted `ProjectSandboxBinding` from durable route metadata.
 * Every authority-bearing field must be present — never infer from cwd.
 */
export function projectSandboxBindingFromManagedRoute(
  managed: ManagedRouteSandboxMetadata,
  projectRoot: string,
  fallbackProvider?: string,
): ProjectSandboxBinding {
  const project_id = requireManagedString(managed.project_id, 'project_id')
  const sandbox_instance_id = requireManagedString(managed.sandbox_instance_id, 'sandbox_instance_id')
  const image_digest = requireManagedString(managed.sandbox_image, 'sandbox_image')
  const policy_hash = requireManagedString(managed.sandbox_policy, 'sandbox_policy')
  const mount_hash = requireManagedString(managed.sandbox_mount, 'sandbox_mount')
  const workspace_id = requireManagedString(managed.sandbox_workspace, 'sandbox_workspace')
  const provider = requireManagedString(managed.sandbox_provider ?? fallbackProvider, 'sandbox_provider')
  const generation = managed.sandbox_generation
  if (!Number.isInteger(generation) || (generation ?? 0) < 1) {
    throw new Error('managed sandbox binding refused: sandbox_generation must be a positive integer')
  }

  return {
    project_id,
    project_root: path.resolve(projectRoot),
    provider,
    sandbox_instance_id,
    sandbox_name: stableProjectSandboxName(project_id),
    image_digest,
    policy_hash,
    mount_hash,
    generation: generation!,
    workspace_id,
  }
}

/**
 * ONE formula for the admitted mount hash — shared by the start stamp and the
 * operator provisioning script so the two can never drift.
 */
export function sandboxMountHashForConfig(
  mountPath: string,
  roots: Readonly<Record<string, { readonly path: string; readonly access: string }>> | undefined,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        mount_path: mountPath,
        roots: Object.entries(roots ?? {})
          .map(([name, root]) => ({ name, path: root.path, access: root.access }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }),
    )
    .digest('hex')
}

/**
 * Realize the binding for a PICKED OAuth lane (L5, dispatch-time binding).
 *
 * The route stamp carries the ADMISSION CONTEXT (image digest, policy hash,
 * mount hash, workspace) — it never demands a per-project sprite identity.
 * The sprite identity is the LANE's: `provider.create` with the lane fields
 * derives the shared lane sprite name and creates-or-reuses that sprite,
 * returning the state whose instance id is the provider's own answer. The
 * same lane always realizes the same sprite; state stays keyed per
 * project × lane so siblings never clobber each other's evidence.
 */
export async function realizeOauthLaneBinding(input: {
  readonly provider: ProjectSandboxProvider
  readonly managed: ManagedRouteSandboxMetadata
  readonly projectRoot: string
  readonly lane: { readonly oauth_lane_id: string; readonly oauth_provider_slug: string }
}): Promise<ProjectSandboxState> {
  const managed = input.managed
  return input.provider.create({
    project_id: requireManagedString(managed.project_id, 'project_id'),
    project_root: path.resolve(input.projectRoot),
    image_digest: requireManagedString(managed.sandbox_image, 'sandbox_image'),
    policy_hash: requireManagedString(managed.sandbox_policy, 'sandbox_policy'),
    mount_hash: requireManagedString(managed.sandbox_mount, 'sandbox_mount'),
    workspace_id: requireManagedString(managed.sandbox_workspace, 'sandbox_workspace'),
    oauth_lane_id: input.lane.oauth_lane_id,
    oauth_provider_slug: input.lane.oauth_provider_slug,
  })
}

/** POSIX single-quote quoting for guest shell commands. */
function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * argv passed to `ProjectSandboxProvider.enter` — runs the agent inside the
 * sprite with the staged work order (stdin redirect or final arg).
 */
export function buildCloudEnterArgv(input: {
  readonly agentArgv: readonly string[]
  readonly mountPath: string
  readonly orderSandboxPath: string
  readonly workOrderVia: 'stdin' | 'arg'
  readonly workOrder: string
  /** Staged guest credential env — inlined into the shell (Sprites exec URL limits). */
  readonly guestEnv?: Readonly<Record<string, string>>
}): string[] {
  if (input.agentArgv.length === 0) {
    throw new Error('managed sandbox enter refused: agent argv is empty')
  }
  const agentCmd = input.agentArgv.map(shq).join(' ')
  const envPrefix =
    input.guestEnv && Object.keys(input.guestEnv).length > 0
      ? `${Object.entries(input.guestEnv)
          .map(([key, value]) => `export ${key}=${shq(value)}`)
          .join('; ')}; `
      : ''
  const workdir = `cd ${shq(input.mountPath)} && `
  // Cloud sprites refuse long exec URLs (414). The work order is always staged
  // at orderSandboxPath in the synced workspace — never inline it in the shell.
  void input.workOrderVia
  void input.workOrder
  return ['/bin/sh', '-lc', `${envPrefix}${workdir}${agentCmd} < ${shq(input.orderSandboxPath)}`]
}

function parseCloudProviderKind(provider: string): CloudSandboxProviderKind {
  if (provider === 'fly-sprites') return provider
  throw new Error(
    `managed sandbox enter refused: provider '${provider}' is not a qualified cloud backend (use fly-sprites)`,
  )
}

/**
 * Resolve the provider for a managed enter attempt. Tests inject
 * `config.sandboxProvider`; production uses the admission-bound factory.
 */
export function resolveManagedSandboxProvider(
  config: Pick<WorkerRecipeRuntimeConfig, 'sandboxProvider'>,
  sandbox: WaypointProjectSandboxConfig,
  providerKind: string,
): ProjectSandboxProvider {
  if (config.sandboxProvider !== undefined) return config.sandboxProvider
  if (providerKind === 'fake') return createProjectSandboxProvider('fake')
  if (!isProductionSandboxBackend(sandbox.backend) && providerKind !== sandbox.backend) {
    throw new Error(
      `managed sandbox enter refused: route provider '${providerKind}' does not match runtime.sandbox.backend '${sandbox.backend}'`,
    )
  }
  // The egress allowlist is the PROJECT's (`runtime.sandbox.egress.allow`) —
  // there is no factory default to fall back to, so a project without one
  // refuses here rather than entering with someone else's policy.
  return createCloudProjectSandboxProvider(parseCloudProviderKind(providerKind), {
    egressAllow: canonicalizeSandboxEgressAllowlist(sandbox.egress.allow ?? []),
  })
}
