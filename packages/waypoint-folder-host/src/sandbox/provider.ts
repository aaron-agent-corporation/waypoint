/**
 * Provider-neutral lifecycle contract for one persistent project sandbox.
 *
 * This module deliberately contains no provider SDK, process, filesystem, or
 * manager-command implementation (the crypto hash below is pure computation).
 * It defines the values a concrete provider must prove and the fail-closed
 * comparisons every caller must perform before entering an existing sandbox.
 *
 * Two sandbox-name derivations exist (L5, docs/designs/sprite-lane-conversion.md):
 * per-PROJECT sprites (`project-<slug>`, the S1/S2 era) and per-LANE sprites
 * (`oauth-<provider>-<hash8>`), selected by whether the binding carries an
 * `oauth_lane_id`. A binding's name must match its own derivation exactly.
 */

import { createHash } from 'node:crypto'

export type ProjectSandboxLifecycle = 'creating' | 'running' | 'stopped' | 'unavailable'

export type ProjectSandboxHealthStatus = 'healthy' | 'degraded' | 'stopped' | 'unavailable'

export type ProjectSandboxProbeResult = 'denied' | 'not_mounted' | 'allowed'

export interface ProjectSandboxBinding {
  /** Stable opaque Console identity. Never derive it from a path. */
  readonly project_id: string
  /** Canonical project root observed when this binding was created. */
  readonly project_root: string
  /** Provider kind, not a provider-issued sandbox identity. */
  readonly provider: string
  /** Opaque identifier issued by the provider for this exact sandbox. */
  readonly sandbox_instance_id: string
  /** Stable provider name derived only from project_id. */
  readonly sandbox_name: string
  /** Qualified OCI reference ending in an immutable sha256 digest. */
  readonly image_digest: string
  /** Lowercase SHA-256 of the admitted execution/network/credential policy. */
  readonly policy_hash: string
  /** Lowercase SHA-256 of the exact resolved mount set. */
  readonly mount_hash: string
  /** Monotonic provider generation for this project binding. */
  readonly generation: number
  /** Stable identity of the persistent project workspace. */
  readonly workspace_id: string
  /**
   * When set, the sandbox is a shared OAuth LANE sprite (L5): sandbox_name is
   * derived from this opaque lane id (never an email), and the same lane names
   * the same sprite across products. Absent for per-project sprites.
   */
  readonly oauth_lane_id?: string
  /** DNS-safe provider slug for the lane sprite name (e.g. 'codex'). */
  readonly oauth_provider_slug?: string
}

export interface ProjectSandboxState extends ProjectSandboxBinding {
  readonly lifecycle: ProjectSandboxLifecycle
  readonly created_at: string
  readonly updated_at: string
}

export interface ProjectSandboxProbe {
  readonly id: string
  readonly result: ProjectSandboxProbeResult
  /** Must never be true; probes report presence only and never secret bytes. */
  readonly secret_plaintext_available?: boolean
}

/** Sprites=Firecracker microvm; exe.dev=KVM. Both are host-virtualized guests. */
export type ProjectSandboxVirtualization = 'microvm' | 'kvm'

export interface ProjectSandboxVerification extends ProjectSandboxBinding {
  readonly enterable: boolean
  readonly virtualization: ProjectSandboxVirtualization
  readonly healthy: boolean
  readonly policy_verified: boolean
  readonly mount_policy_verified: boolean
  readonly observed_at: string
  readonly probes: readonly ProjectSandboxProbe[]
}

export interface ProjectSandboxHealth extends ProjectSandboxBinding {
  readonly status: ProjectSandboxHealthStatus
  readonly healthy: boolean
  readonly virtualization: ProjectSandboxVirtualization
  readonly observed_at: string
}

export interface ProjectSandboxCreateInput {
  readonly project_id: string
  readonly project_root: string
  readonly image_digest: string
  readonly policy_hash: string
  readonly mount_hash: string
  readonly workspace_id: string
  /** Create/reuse a shared LANE sprite instead of the per-project one (L5). */
  readonly oauth_lane_id?: string
  readonly oauth_provider_slug?: string
}

export interface ProjectSandboxEnterInput {
  readonly argv: readonly string[]
  /** Guest environment for Sprites exec (lane credential homes, etc.). */
  readonly env?: Readonly<Record<string, string>>
}

export interface ProjectSandboxEnterResult {
  readonly exit_code: number
  readonly stdout: string
  readonly stderr: string
  readonly observed_at: string
}

/** Manager/runtime lifecycle authority. Destruction is intentionally absent. */
export interface ProjectSandboxProvider {
  create(input: ProjectSandboxCreateInput): Promise<ProjectSandboxState>
  inspect(binding: ProjectSandboxBinding): Promise<ProjectSandboxState | null>
  /** Read-only lookup by opaque project_id for restart reconciliation. */
  inspectByProjectId?(projectId: string): Promise<ProjectSandboxState | null>
  verify(binding: ProjectSandboxBinding): Promise<ProjectSandboxVerification>
  enter(binding: ProjectSandboxBinding, input: ProjectSandboxEnterInput): Promise<ProjectSandboxEnterResult>
  health(binding: ProjectSandboxBinding): Promise<ProjectSandboxHealth>
  stop(binding: ProjectSandboxBinding): Promise<void>
  /**
   * Destroy a sprite whose PLACEMENT is sick so the next dispatch draws a
   * fresh one. This is NOT general destruction authority (that stays
   * operator-only via OperatorProjectSandboxProvider.destroy): the single
   * sanctioned trigger is transport-death exhaustion inside the guest
   * (sandbox/sprite-recycle.ts — Aaron's 2026-08-30 amendment to D-B), and
   * a sprite is a stateless cache, so nothing durable is lost. Optional:
   * providers without it simply leave the sick placement in service.
   */
  recycleSandbox?(binding: ProjectSandboxBinding, reason: string): Promise<void>
}

export interface ProjectSandboxDestroyAuthorization {
  readonly action: 'sandbox.destroy'
  readonly audience: 'operator'
  readonly authorization_id: string
  readonly project_id: string
  readonly sandbox_instance_id: string
  readonly expires_at: string
}

/** Separate operator-only authority; never use this as a manager tool type. */
export interface OperatorProjectSandboxProvider extends ProjectSandboxProvider {
  destroy(binding: ProjectSandboxBinding, authorization: ProjectSandboxDestroyAuthorization): Promise<void>
}

export const PROJECT_SANDBOX_MANAGER_ACTIONS = ['create', 'inspect', 'verify', 'enter', 'health', 'stop'] as const

export type ProjectSandboxManagerAction = (typeof PROJECT_SANDBOX_MANAGER_ACTIONS)[number]

const PROJECT_ID = /^prj_[A-Za-z0-9_-]{1,96}$/
const PROVIDER_KIND = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SHA256 = /^[0-9a-f]{64}$/
const QUALIFIED_IMAGE_DIGEST = /^[^\s/@]+(?::[0-9]+)?\/[^\s@]+@sha256:[0-9a-f]{64}$/
const OPAQUE_ID = /^[^\s\u0000-\u001f\u007f]{1,256}$/

const BINDING_FIELDS = [
  ['project_id', 'project'],
  ['project_root', 'project.path'],
  ['provider', 'provider'],
  ['sandbox_instance_id', 'sandbox.instance'],
  ['sandbox_name', 'sandbox.name'],
  ['image_digest', 'image.digest'],
  ['policy_hash', 'policy.digest'],
  ['mount_hash', 'mount.hash'],
  ['generation', 'generation'],
  ['workspace_id', 'workspace'],
  ['oauth_lane_id', 'oauth.lane'],
  ['oauth_provider_slug', 'oauth.provider'],
] as const satisfies readonly (readonly [keyof ProjectSandboxBinding, string])[]

/** Required boundary probes and the only results that admit a verification. */
export const REQUIRED_PROBES: Readonly<Record<string, readonly ProjectSandboxProbeResult[]>> = {
  'portfolio-store-read': ['denied', 'not_mounted'],
  'manager-brief-read': ['denied', 'not_mounted'],
  'other-project-read': ['denied', 'not_mounted'],
  'host-home-secret-read': ['denied', 'not_mounted'],
  'denied-host-egress': ['denied'],
  'raw-ip-egress': ['denied'],
  'allowlisted-model-egress': ['allowed'],
  'parallel-write-collision': ['denied'],
  'managed-host-fallback': ['denied'],
  'forged-managed-start': ['denied'],
}

/**
 * Canonical egress allowlist used when deriving `policy_hash`.
 *
 * Callers must hash the same sorted, lowercased domain list into the binding's
 * `policy_hash` that the cloud provider later enforces via network policy
 * (Sprites) before enter(). Domain order and casing must not change the digest.
 */
export function canonicalizeSandboxEgressAllowlist(hosts: readonly string[]): readonly string[] {
  return [...new Set(hosts.map((host) => host.trim().toLowerCase()).filter((host) => host.length > 0))].sort()
}

/** Stable provider name derived from the opaque project ID, never its path. */
export function stableProjectSandboxName(projectId: string): string {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error('sandbox binding invalid: project_id must be a bounded opaque prj_ identifier')
  }
  // Provider-facing sandbox names must be DNS-safe (Sprites rejects underscores).
  const dnsSafe = projectId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `project-${dnsSafe}`
}

/**
 * Stable sprite name for one OAuth / Console subscription lane (L5). Hash slug
 * only: the lane email or raw label must never reach a sprite name (dashboard /
 * URL surface). The hash preimage matches Waypoint's, so the same account
 * lane names the same sprite across both products — one account, one sprite,
 * one lock, globally.
 */
export function stableOauthSandboxName(laneId: string, providerSlug = 'lane'): string {
  const id = laneId.trim()
  if (!id || id.length > 256) {
    throw new Error('sandbox binding invalid: oauth_lane_id must be a non-empty opaque id (≤256 chars)')
  }
  const slug =
    providerSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'lane'
  const hash = createHash('sha256').update(`waypoint:oauth-lane:${id}`).digest('hex').slice(0, 8)
  return `oauth-${slug}-${hash}`
}

/** The name a binding-like value's own identity fields demand. */
export function expectedSandboxName(binding: {
  readonly project_id: string
  readonly oauth_lane_id?: string
  readonly oauth_provider_slug?: string
}): string {
  return binding.oauth_lane_id
    ? stableOauthSandboxName(binding.oauth_lane_id, binding.oauth_provider_slug ?? 'lane')
    : stableProjectSandboxName(binding.project_id)
}

/**
 * The policy digest a binding must carry for a given egress allowlist — and
 * the digest the provider RECOMPUTES at enter against the allowlist it will
 * actually POST (L5: recorded-not-enforced closes; a binding whose hash does
 * not match the enforced policy refuses before any workload).
 */
export function policyHashForEgress(egressAllow: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeSandboxEgressAllowlist(egressAllow)))
    .digest('hex')
}

/**
 * Per-project guest workspace under the shared mount base (L2 hygiene,
 * docs/designs/sprite-lane-conversion.md). A shared lane sprite hosts many
 * projects; each one syncs, runs, and is wiped strictly inside its own slug
 * directory — never the bare base, which would take sibling workspaces with it.
 */
export function guestWorkspacePath(mountBase: string, projectId: string): string {
  if (!isAbsolutePath(mountBase)) {
    throw new Error('guest workspace refused: mount base must be an absolute canonical path')
  }
  if (!PROJECT_ID.test(projectId)) {
    throw new Error('sandbox binding invalid: project_id must be a bounded opaque prj_ identifier')
  }
  const slug = projectId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${mountBase.replace(/\/+$/, '')}/${slug}`
}

/** Validate one binding even when there is no second value to compare. */
export function assertValidProjectSandboxBinding(binding: ProjectSandboxBinding): void {
  if (!PROJECT_ID.test(binding.project_id)) {
    throw new Error('sandbox binding invalid: project_id must be a bounded opaque prj_ identifier')
  }
  if (!isAbsolutePath(binding.project_root)) {
    throw new Error('sandbox binding invalid: project.path must be an absolute canonical path')
  }
  if (!PROVIDER_KIND.test(binding.provider)) {
    throw new Error('sandbox binding invalid: provider must be a bounded lowercase kind')
  }
  assertOpaqueId('sandbox.instance', binding.sandbox_instance_id)
  if (binding.sandbox_name !== expectedSandboxName(binding)) {
    throw new Error(
      binding.oauth_lane_id
        ? 'sandbox binding mismatch: sandbox.name is not derived from oauth_lane_id'
        : 'sandbox binding mismatch: sandbox.name is not derived from project_id',
    )
  }
  if (!QUALIFIED_IMAGE_DIGEST.test(binding.image_digest)) {
    throw new Error('sandbox binding invalid: image.digest must be registry-qualified and sha256-pinned')
  }
  if (!SHA256.test(binding.policy_hash)) {
    throw new Error('sandbox binding invalid: policy.digest must be 64 lowercase hexadecimal characters')
  }
  if (!SHA256.test(binding.mount_hash)) {
    throw new Error('sandbox binding invalid: mount.hash must be 64 lowercase hexadecimal characters')
  }
  if (!Number.isSafeInteger(binding.generation) || binding.generation < 1) {
    throw new Error('sandbox binding invalid: generation must be a positive safe integer')
  }
  assertOpaqueId('workspace', binding.workspace_id)

  const aliases = [
    binding.provider,
    binding.sandbox_name,
    binding.project_id,
    binding.project_root,
    String(binding.generation),
    binding.image_digest,
    binding.policy_hash,
    binding.mount_hash,
    binding.workspace_id,
  ]
  if (aliases.includes(binding.sandbox_instance_id)) {
    throw new Error('sandbox binding invalid: sandbox.instance must be a distinct provider-issued identifier')
  }
}

/** Compare every authority-bearing claim independently and fail on any drift. */
export function assertProjectSandboxBinding(expected: ProjectSandboxBinding, actual: ProjectSandboxBinding): void {
  assertValidProjectSandboxBinding(expected)
  assertValidProjectSandboxBinding(actual)
  for (const [field, label] of BINDING_FIELDS) {
    if (expected[field] !== actual[field]) {
      throw new Error(`sandbox binding mismatch: ${label}`)
    }
  }
}

/** A successful verification is usable only when every required boundary probe is present and safe. */
export function assertProjectSandboxVerification(
  binding: ProjectSandboxBinding,
  verification: ProjectSandboxVerification,
): void {
  assertProjectSandboxBinding(binding, verification)
  assertTimestamp('verification.observed_at', verification.observed_at)
  if (verification.virtualization !== 'microvm' && verification.virtualization !== 'kvm') {
    throw new Error('sandbox verification failed: virtualization must be microvm or kvm')
  }
  if (!verification.enterable) {
    throw new Error('sandbox verification failed: sandbox is not enterable')
  }
  if (!verification.healthy) {
    throw new Error('sandbox verification failed: health is not healthy')
  }
  if (!verification.policy_verified) {
    throw new Error('sandbox verification failed: policy digest is unverified')
  }
  if (!verification.mount_policy_verified) {
    throw new Error('sandbox verification failed: mount hash is unverified')
  }

  const probes = new Map<string, ProjectSandboxProbe>()
  for (const probe of verification.probes) {
    if (probes.has(probe.id)) throw new Error(`sandbox verification failed: duplicate probe ${probe.id}`)
    if (probe.secret_plaintext_available === true) {
      throw new Error(`sandbox verification failed: probe ${probe.id} exposed secret plaintext`)
    }
    probes.set(probe.id, probe)
  }
  for (const [probeId, admittedResults] of Object.entries(REQUIRED_PROBES)) {
    const probe = probes.get(probeId)
    if (probe === undefined) throw new Error(`sandbox verification failed: missing boundary probe ${probeId}`)
    if (!admittedResults.includes(probe.result)) {
      throw new Error(`sandbox verification failed: boundary probe ${probeId} returned ${probe.result}`)
    }
  }
}

export function assertProjectSandboxState(binding: ProjectSandboxBinding, state: ProjectSandboxState): void {
  assertProjectSandboxBinding(binding, state)
  if (!['creating', 'running', 'stopped', 'unavailable'].includes(state.lifecycle)) {
    throw new Error('sandbox state invalid: lifecycle')
  }
  assertTimestamp('state.created_at', state.created_at)
  assertTimestamp('state.updated_at', state.updated_at)
  if (Date.parse(state.updated_at) < Date.parse(state.created_at)) {
    throw new Error('sandbox state invalid: updated_at precedes created_at')
  }
}

export function assertProjectSandboxHealth(binding: ProjectSandboxBinding, health: ProjectSandboxHealth): void {
  assertProjectSandboxBinding(binding, health)
  assertTimestamp('health.observed_at', health.observed_at)
  if (health.virtualization !== 'microvm' && health.virtualization !== 'kvm') {
    throw new Error('sandbox health failed: virtualization must be microvm or kvm')
  }
  if (!['healthy', 'degraded', 'stopped', 'unavailable'].includes(health.status)) {
    throw new Error('sandbox health failed: invalid status')
  }
  if (health.status === 'healthy' && !health.healthy) throw new Error('sandbox health failed: contradictory healthy status')
  if (health.status !== 'healthy' && health.healthy) throw new Error('sandbox health failed: contradictory non-healthy status')
}

export function assertProjectSandboxDestroyAuthorization(
  binding: ProjectSandboxBinding,
  authorization: ProjectSandboxDestroyAuthorization,
  now: Date = new Date(),
): void {
  assertValidProjectSandboxBinding(binding)
  if (authorization.action !== 'sandbox.destroy' || authorization.audience !== 'operator') {
    throw new Error('sandbox destroy refused: distinct operator authorization required')
  }
  assertOpaqueId('destroy.authorization', authorization.authorization_id)
  if (authorization.project_id !== binding.project_id) throw new Error('sandbox destroy refused: project mismatch')
  if (authorization.sandbox_instance_id !== binding.sandbox_instance_id) {
    throw new Error('sandbox destroy refused: sandbox.instance mismatch')
  }
  assertTimestamp('destroy.expires_at', authorization.expires_at)
  if (Date.parse(authorization.expires_at) <= now.getTime()) throw new Error('sandbox destroy refused: authorization expired')
}

function assertOpaqueId(label: string, value: string): void {
  if (!OPAQUE_ID.test(value)) throw new Error(`sandbox binding invalid: ${label} must be a bounded opaque identifier`)
}

function assertTimestamp(label: string, value: string): void {
  if (value.trim() === '' || !Number.isFinite(Date.parse(value))) throw new Error(`sandbox evidence invalid: ${label}`)
}

function isAbsolutePath(value: string): boolean {
  if (value.includes('\u0000')) return false
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}
