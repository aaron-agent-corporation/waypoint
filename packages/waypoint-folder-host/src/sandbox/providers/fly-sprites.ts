/**
 * Fly.io Sprites ProjectSandboxProvider (Firecracker microvm).
 *
 * Control plane + exec: pinned `@fly/sprites` SDK (L1 of the lane conversion,
 * D-A ruled 2026-08-28 — the hand-rolled REST/WS client this replaces was
 * witnessed through S1/S2 and retires with its history). Unit tests inject a
 * client-shaped double at the SDK boundary — never mock raw REST/WS.
 *
 * Network policy is deny-by-default: before enter/sync we POST only the
 * admitted egress allowlist and READ IT BACK. That allowlist must be the same
 * canonical list hashed into the binding's policy_hash. There is deliberately
 * NO default allowlist anywhere — the project's `runtime.sandbox.egress.allow`
 * is the only source.
 *
 * Every exec is bounded by a host-side deadline (L1): a wedged transport frees
 * itself by killing the sprite's sessions and failing the attempt — a hung
 * enter must never be indistinguishable from a slow sprite, and (L3) must
 * never hold a lane lock forever.
 *
 * stop() ends active exec sessions so the sprite can idle-hibernate. It never
 * DELETE-destroys the sprite (destruction is operator-only, D-B — amended
 * 2026-08-30 by Aaron with ONE exception: recycleSandbox destroys a sprite
 * after in-guest transport-death exhaustion, because the 08-30 experiment
 * proved that failure is the PLACEMENT's, and a redraw is the fix).
 *
 * Shared-sprite hygiene (L2): every sync WIPES its destination first so the
 * guest exactly mirrors the host — warm workspaces are never additive and a
 * host-deleted file can never resurrect on the pull leg (the S2 finding).
 * Wipes and deletes refuse any target that is not a proper per-project guest
 * directory (bare `/work`, `/opt`, `/` all refuse): on a lane sprite the base
 * holds sibling projects' workspaces. Guest-bundle installs go through
 * ensureGuestBundle, whose skip probe verifies the TREE — marker alone never
 * skips (a matching marker over a broken tree is a crash loop pinned across
 * rebuilds), and placeholder revisions refuse before any exec.
 */

import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { SpritesClient } from '@fly/sprites'

import {
  assertProjectSandboxBinding,
  assertProjectSandboxVerification,
  canonicalizeSandboxEgressAllowlist,
  expectedSandboxName,
  policyHashForEgress,
  stableProjectSandboxName,
  type ProjectSandboxBinding,
  type ProjectSandboxCreateInput,
  type ProjectSandboxEnterInput,
  type ProjectSandboxEnterResult,
  type ProjectSandboxHealth,
  type ProjectSandboxProvider,
  type ProjectSandboxState,
  type ProjectSandboxVerification,
} from '../provider.ts'
import { createHostDirTarStream, createHostProjectTarStream } from '../../runtime/host-project-tar.ts'
import { readSandboxState, sandboxStateKey, writeSandboxState } from '../state-store.ts'
import {
  defaultGuestProbeContext,
  guestProbeShell,
  probeFromEnterOutput,
  requiredProbeIds,
  type GuestProbeContext,
} from './probes.ts'

export const FLY_SPRITES_PROVIDER_KIND = 'fly-sprites' as const
/** Builtin fallback (may include `/v1`); the SDK base URL strips the version suffix. */
export const SPRITES_API_BASE = 'https://api.sprites.dev/v1'
// Re-exported so existing importers keep working; the resolution ladder
// (env → Waypoint's own token file) lives in sprites-token.ts.
export { SPRITES_TOKEN_ENV } from '../sprites-token.ts'
import { resolveSpritesToken, spritesTokenRefusal } from '../sprites-token.ts'
export const FLY_SPRITES_SDK = '@fly/sprites@0.2.0' as const
/** Host-side ceiling on any single exec (worker enters run tens of minutes). */
export const DEFAULT_EXEC_DEADLINE_MS = 45 * 60 * 1000
/** Revision marker inside an installed guest bundle dir — written LAST, after a
 *  successful wipe + extract, so a half-install can never read as installed. */
export const GUEST_REVISION_MARKER = '.cordis-revision'

/**
 * A guest path may be wiped/deleted only when it is a proper per-project (or
 * per-purpose) subdirectory — normalized, absolute, no dot segments, depth ≥ 2.
 * Bare `/work` refuses: on a shared lane sprite it holds sibling workspaces.
 */
export function assertWipeSafeGuestPath(guestPath: string): string {
  const normalized = guestPath.replace(/\/+/g, '/').replace(/(.)\/+$/, '$1')
  const segments = normalized.split('/')
  const unsafe =
    !normalized.startsWith('/') ||
    segments.length < 3 ||
    segments.some((segment, index) => index > 0 && (segment === '' || segment === '.' || segment === '..'))
  if (unsafe) {
    throw new Error(
      `fly-sprites guest wipe refused: '${guestPath}' is not a per-project guest directory — ` +
        'wiping a shared base (bare /work, /opt, /) on a lane sprite would destroy sibling workspaces',
    )
  }
  return normalized
}

/**
 * A bundle revision must be a real sha256 digest (optionally registry-
 * qualified). Degenerate placeholders (64 identical hex chars) refuse: a
 * placeholder stamped as a marker pins a broken guest tree across rebuilds.
 */
export function assertRealBundleRevision(revision: string): string {
  const trimmed = revision.trim()
  const match = /^(?:[a-z0-9._/-]+@)?sha256:([0-9a-f]{64})$/.exec(trimmed)
  if (!match) {
    throw new Error(`fly-sprites guest install refused: '${revision}' is not a sha256-pinned bundle revision`)
  }
  const hex = match[1]!
  if (/^(.)\1{63}$/.test(hex)) {
    throw new Error(
      `fly-sprites guest install refused: bundle revision is a placeholder digest (64×'${hex[0]}') — ` +
        'build the guest bundle and pin its real digest',
    )
  }
  return trimmed
}

/** @deprecated The REST/WS transport is gone; kept so older call sites typecheck. */
export type FetchLike = typeof fetch

export type FlySpritesExecResultLike = {
  readonly stdout: string | Buffer
  readonly stderr: string | Buffer
  readonly exitCode: number
}

export type FlySpritesCommandLike = {
  readonly stdin: NodeJS.WritableStream
  readonly stdout: AsyncIterable<unknown> | NodeJS.ReadableStream
  readonly stderr: AsyncIterable<unknown> | NodeJS.ReadableStream
  wait(): Promise<number>
  once(event: 'spawn', listener: () => void): unknown
  once(event: 'error', listener: (err: Error) => void): unknown
}

export type FlySpritesSpriteLike = {
  readonly name: string
  id?: string
  status?: string
  createdAt?: Date
  updatedAt?: Date
  execFile(
    file: string,
    args?: string[],
    options?: { env?: Record<string, string> },
  ): Promise<FlySpritesExecResultLike>
  spawn(command: string, args?: string[]): FlySpritesCommandLike
  /** HTTP filesystem API — bulk reads ride this, never exec stdout (64KB race). */
  filesystem(workingDir?: string): FlySpritesFilesystemLike
  updateNetworkPolicy(policy: {
    rules: Array<{ action?: 'allow' | 'deny'; domain?: string }>
  }): Promise<void>
  getNetworkPolicy(): Promise<{ rules?: Array<{ action?: string; domain?: string }> }>
  listSessions(): Promise<Array<{ id?: string | number }>>
  killSession(sessionId: string): Promise<AsyncIterable<unknown> | void>
}

export type FlySpritesFilesystemLike = {
  readFile(path: string, encoding?: null): Promise<Buffer>
  stat(path: string): Promise<{ size?: number }>
  rm(path: string): Promise<void>
}

export type FlySpritesClientLike = {
  sprite(name: string): FlySpritesSpriteLike
  createSprite(name: string): Promise<FlySpritesSpriteLike>
  getSprite(name: string): Promise<FlySpritesSpriteLike>
  deleteSprite(name: string): Promise<void>
}

export interface FlySpritesProjectSandboxProviderOptions {
  /** Override SPRITES_TOKEN. Fail closed when missing/blank (unless `client` is injected). */
  readonly token?: string
  /**
   * Injected SDK client (tests). When set, token/apiBase are not required.
   * Production constructs `SpritesClient` from token + SPRITES_API_BASE.
   */
  readonly client?: FlySpritesClientLike
  readonly apiBase?: string
  /**
   * Domains admitted for outbound egress. Must match the allowlist hashed into
   * policy_hash for this binding. Empty means deny-all (we refuse before POST —
   * Sprites treats an empty rule list as UNRESTRICTED).
   */
  readonly egressAllow?: readonly string[]
  readonly probeContext?: Partial<GuestProbeContext>
  readonly now?: () => Date
  /** Host-side ceiling per exec; a breach kills the sprite's sessions and throws. */
  readonly execDeadlineMs?: number
  /** @deprecated REST transport is gone. Ignored. */
  readonly fetch?: FetchLike
  /** @deprecated WS transport is gone. Ignored. */
  readonly WebSocket?: typeof WebSocket
}

class ExecDeadlineExceeded extends Error {}

export class FlySpritesProjectSandboxProvider implements ProjectSandboxProvider {
  readonly provider = FLY_SPRITES_PROVIDER_KIND
  readonly #client: FlySpritesClientLike
  readonly #egressAllow: readonly string[]
  readonly #probeContext: GuestProbeContext
  readonly #now: () => Date
  readonly #deadlineMs: number
  readonly #bindings = new Map<string, ProjectSandboxState>()
  readonly #stopped = new Set<string>()

  constructor(options: FlySpritesProjectSandboxProviderOptions = {}) {
    if (options.client) {
      this.#client = options.client
    } else {
      const injected = options.token?.trim()
      const resolved = injected ? null : resolveSpritesToken()
      for (const warning of resolved?.warnings ?? []) {
        // A secret anyone can read must never be a silent condition.
        console.error(`[fly-sprites] ${warning}`)
      }
      const token = injected || resolved?.token || ''
      if (!token) {
        throw new Error(spritesTokenRefusal(resolved?.searched ?? []))
      }
      const rawBase = options.apiBase ?? SPRITES_API_BASE
      this.#client = new SpritesClient(token, { baseURL: normalizeSdkBaseURL(rawBase) }) as unknown as FlySpritesClientLike
    }
    this.#egressAllow = canonicalizeSandboxEgressAllowlist(options.egressAllow ?? [])
    this.#probeContext = defaultGuestProbeContext({
      ...(this.#egressAllow[0] ? { allowlistedHost: this.#egressAllow[0] } : {}),
      ...options.probeContext,
    })
    this.#now = options.now ?? (() => new Date())
    this.#deadlineMs = options.execDeadlineMs ?? DEFAULT_EXEC_DEADLINE_MS
  }

  async create(input: ProjectSandboxCreateInput): Promise<ProjectSandboxState> {
    const sandbox_name = expectedSandboxName(input)
    const existing = this.#bindings.get(sandboxStateKey({ ...input, sandbox_name }))
    if (existing) {
      assertProjectSandboxBinding(existing, { ...existing, ...input, provider: this.provider })
      return existing
    }
    const sprite = (await this.#getSpriteOrNull(sandbox_name)) ?? (await this.#client.createSprite(sandbox_name))
    const instanceId = sprite.id
    if (!instanceId || instanceId === sandbox_name) {
      throw new Error('fly-sprites create refused: provider did not return a distinct sandbox.instance id')
    }

    const observed = this.#iso()
    const state: ProjectSandboxState = {
      ...input,
      provider: this.provider,
      sandbox_instance_id: instanceId,
      sandbox_name,
      generation: 1,
      lifecycle: mapSpriteLifecycle(sprite.status),
      created_at: toIso(sprite.createdAt) ?? observed,
      updated_at: toIso(sprite.updatedAt) ?? observed,
    }
    this.#bindings.set(sandboxStateKey(state), state)
    this.#stopped.delete(instanceId)
    writeSandboxState(state)
    return state
  }

  async inspectByProjectId(projectId: string): Promise<ProjectSandboxState | null> {
    const local = this.#bindings.get(projectId)
    if (local) {
      const remote = await this.#getSpriteOrNull(local.sandbox_name)
      if (!remote) return null
      return { ...local, lifecycle: mapSpriteLifecycle(remote.status), updated_at: this.#iso() }
    }
    const durable = readSandboxState(projectId)
    if (!durable || durable.provider !== this.provider || durable.project_id !== projectId) {
      const sandbox_name = stableProjectSandboxName(projectId)
      const remote = await this.#getSpriteOrNull(sandbox_name)
      // Remote exists without recoverable host evidence — unavailable (do not fabricate digests).
      if (remote) {
        const err = new Error('sandbox_unavailable: remote sprite exists without durable host binding evidence')
        ;(err as Error & { code?: string }).code = 'sandbox_unavailable'
        throw err
      }
      return null
    }
    const remote = await this.#getSpriteOrNull(durable.sandbox_name)
    if (!remote) return null
    const updated = { ...durable, lifecycle: mapSpriteLifecycle(remote.status), updated_at: this.#iso() }
    this.#bindings.set(projectId, updated)
    return updated
  }

  async inspect(binding: ProjectSandboxBinding): Promise<ProjectSandboxState | null> {
    this.#assertProvider(binding)
    const local =
      this.#bindings.get(sandboxStateKey(binding)) ??
      this.#rehydrate(binding) ??
      (binding.oauth_lane_id ? null : await this.inspectByProjectId(binding.project_id))
    if (!local) {
      // Remote may exist, but without durable host evidence we refuse to fabricate digests.
      return null
    }
    assertProjectSandboxBinding(local, binding)
    const remote = await this.#getSpriteOrNull(binding.sandbox_name)
    if (!remote) return null
    const updated: ProjectSandboxState = {
      ...local,
      lifecycle: this.#stopped.has(local.sandbox_instance_id)
        ? 'stopped'
        : mapSpriteLifecycle(remote.status),
      updated_at: toIso(remote.updatedAt) ?? this.#iso(),
    }
    this.#bindings.set(sandboxStateKey(updated), updated)
    return updated
  }

  async verify(binding: ProjectSandboxBinding): Promise<ProjectSandboxVerification> {
    const state = await this.inspect(binding)
    if (!state) throw new Error('sandbox not found')
    assertProjectSandboxBinding(state, binding)
    await this.#ensureNetworkPolicy(binding)

    const probes = []
    for (const probeId of requiredProbeIds()) {
      const script = guestProbeShell(probeId, this.#probeContext)
      const result = await this.enter(binding, {
        argv: ['/bin/sh', '-lc', script],
      })
      probes.push(probeFromEnterOutput(probeId, result.stdout, result.exit_code))
    }

    // Enter wakes cold sprites and clears the local stopped mark; re-read remote status.
    const remote = await this.#getSpriteOrNull(binding.sandbox_name)
    const lifecycle = remote
      ? mapSpriteLifecycle(remote.status)
      : this.#stopped.has(binding.sandbox_instance_id)
        ? 'stopped'
        : 'running'
    const healthy =
      !this.#stopped.has(binding.sandbox_instance_id) && lifecycle === 'running'
    const refreshed: ProjectSandboxState = {
      ...state,
      lifecycle,
      updated_at: toIso(remote?.updatedAt) ?? this.#iso(),
    }
    this.#bindings.set(sandboxStateKey(refreshed), refreshed)
    writeSandboxState(refreshed)

    const verification: ProjectSandboxVerification = {
      ...refreshed,
      enterable: healthy,
      virtualization: 'microvm',
      healthy,
      policy_verified: true,
      mount_policy_verified: true,
      observed_at: this.#iso(),
      probes,
    }
    assertProjectSandboxVerification(binding, verification)
    return verification
  }

  async enter(binding: ProjectSandboxBinding, input: ProjectSandboxEnterInput): Promise<ProjectSandboxEnterResult> {
    this.#assertProvider(binding)
    const local =
      this.#bindings.get(sandboxStateKey(binding)) ??
      this.#rehydrate(binding) ??
      (binding.oauth_lane_id ? null : await this.inspectByProjectId(binding.project_id))
    if (!local) throw new Error('sandbox not found')
    assertProjectSandboxBinding(local, binding)
    await this.#ensureNetworkPolicy(binding)

    const argv = input.argv
    if (argv.length === 0) throw new Error('fly-sprites enter refused: argv is empty')

    // Worker agents may run for tens of minutes; the SDK's WS spawn carries that.
    const sprite = this.#client.sprite(binding.sandbox_name)
    const result = await this.#execStream(sprite, argv, Readable.from([]))
    this.#stopped.delete(binding.sandbox_instance_id)
    return result
  }

  /**
   * Stream a host directory into the sprite at `guestPath` via tar
   * (subscription homes, guest bundle installs). Wipes the destination first
   * so the guest EXACTLY mirrors the host — a stale file under an overlay sync
   * is the crash-loop trap (L2). The wipe guard means `guestPath` must be a
   * proper per-purpose subdirectory (never bare /work, /opt, /).
   */
  async syncHostDirectory(
    binding: ProjectSandboxBinding,
    input: { readonly hostPath: string; readonly guestPath: string },
  ): Promise<void> {
    this.#assertProvider(binding)
    const guestPath = assertWipeSafeGuestPath(input.guestPath)
    const local =
      this.#bindings.get(sandboxStateKey(binding)) ??
      this.#rehydrate(binding) ??
      (binding.oauth_lane_id ? null : await this.inspectByProjectId(binding.project_id))
    if (!local) throw new Error('sandbox not found')
    assertProjectSandboxBinding(local, binding)
    await this.#ensureNetworkPolicy(binding)

    const sprite = this.#client.sprite(binding.sandbox_name)
    await this.#wipeGuestDir(sprite, guestPath)
    const mkdir = await this.#execFile(sprite, ['/bin/mkdir', '-p', guestPath])
    if (mkdir.exit_code !== 0) {
      throw new Error(`fly-sprites credential sync refused: mkdir ${guestPath} exited ${mkdir.exit_code}`)
    }
    const tar = createHostDirTarStream(input.hostPath)
    try {
      const extracted = await this.#execStream(sprite, ['/bin/tar', '-xf', '-', '-C', guestPath], tar.stdout)
      await tar.done
      if (extracted.exit_code !== 0) {
        throw new Error(
          `fly-sprites credential sync refused: tar extract exited ${extracted.exit_code}${extracted.stderr ? `: ${extracted.stderr.trim()}` : ''}`,
        )
      }
    } finally {
      tar.stdout.destroy()
    }
    this.#stopped.delete(binding.sandbox_instance_id)
  }

  /**
   * Stream the host project tree into the sprite at `mountPath` via tar.
   * Called before worker enter so the per-project workspace dir exists.
   * `mountPath` must be the project's slug directory (guestWorkspacePath —
   * e.g. `/work/prj-x`), never the bare mount base: the wipe-before-sync
   * that makes warm workspaces exactly mirror the host (no additive overlay,
   * no resurrection of host-deleted files — the S2 finding) refuses shared
   * bases outright.
   */
  async syncProjectWorkspace(
    binding: ProjectSandboxBinding,
    input: { readonly projectRoot: string; readonly mountPath: string },
  ): Promise<void> {
    this.#assertProvider(binding)
    const mountPath = assertWipeSafeGuestPath(input.mountPath)
    const local =
      this.#bindings.get(sandboxStateKey(binding)) ??
      this.#rehydrate(binding) ??
      (binding.oauth_lane_id ? null : await this.inspectByProjectId(binding.project_id))
    if (!local) throw new Error('sandbox not found')
    assertProjectSandboxBinding(local, binding)
    await this.#ensureNetworkPolicy(binding)

    const sprite = this.#client.sprite(binding.sandbox_name)
    await this.#wipeGuestDir(sprite, mountPath)
    const mkdir = await this.#execFile(sprite, ['/bin/mkdir', '-p', mountPath])
    if (mkdir.exit_code !== 0) {
      throw new Error(`fly-sprites workspace sync refused: mkdir ${mountPath} exited ${mkdir.exit_code}`)
    }
    const tar = createHostProjectTarStream(input.projectRoot)
    try {
      const extracted = await this.#execStream(sprite, ['/bin/tar', '-xf', '-', '-C', mountPath], tar.stdout)
      await tar.done
      if (extracted.exit_code !== 0) {
        throw new Error(
          `fly-sprites workspace sync refused: tar extract exited ${extracted.exit_code}${extracted.stderr ? `: ${extracted.stderr.trim()}` : ''}`,
        )
      }
    } finally {
      tar.stdout.destroy()
    }
    this.#stopped.delete(binding.sandbox_instance_id)
  }

  /**
   * Pull a bounded set of result paths back OUT of the sprite as a tar buffer
   * (S1 finding: sprites have no bind mounts — without this leg every jailed
   * run reports "wrote no claim"). `relPaths` are mount-relative and
   * CALLER-CHOSEN — the granted write surface plus the claim — so the pull is
   * also the write jail enforced on the return leg: a guest write outside the
   * granted set never returns. Returns null when none of the paths exist
   * (guest exit 8); any other nonzero exit throws — callers fail the attempt.
   * The SDK's byte streams carry the tar directly (the base64 leg the WS
   * transport needed is gone).
   */
  async pullGuestPaths(
    binding: ProjectSandboxBinding,
    input: { readonly mountPath: string; readonly relPaths: readonly string[] },
  ): Promise<Buffer | null> {
    this.#assertProvider(binding)
    if (input.relPaths.length === 0) return null
    for (const rel of input.relPaths) {
      if (rel.startsWith('/') || rel.split('/').includes('..') || rel.includes('\n')) {
        throw new Error(`fly-sprites result pull refused: '${rel}' is not a safe mount-relative path`)
      }
    }
    const list = input.relPaths.map((rel) => `[ -e ${shq(rel)} ] && printf '%s\\n' ${shq(rel)} >> "$L"`).join('; ')
    // The archive NEVER rides exec stdout: the exec WebSocket signals EOF the
    // moment the exit frame lands, dropping whatever stdout is still buffered
    // — route-010 (2026-08-31) truncated 8 pulls at exactly ~65535 bytes, and
    // one half-parsed stream unpacked JSON fragments as filenames in the case
    // root. The tar lands in a guest temp file; the bytes come home over the
    // Sprites filesystem HTTP API, size-verified against stat, and the temp
    // file is removed loud-but-nonfatally. stdout carries only the mktemp
    // path (tiny, and guarded — noise fails closed naming its bytes).
    const script =
      `cd ${shq(input.mountPath)} || exit 9; ` +
      `L=$(mktemp); ` +
      `${list}; ` +
      `[ -s "$L" ] || exit 8; ` +
      `T=$(mktemp /tmp/waypoint-pull-XXXXXX); ` +
      `tar -cf "$T" -T "$L" || { rm -f "$T"; exit 7; }; ` +
      `printf '%s' "$T"`
    const sprite = this.#client.sprite(binding.sandbox_name)
    // NOT a login shell: profiles would print in front of the path.
    const result = await this.#execStream(sprite, ['/bin/sh', '-c', script], Readable.from([]))
    this.#stopped.delete(binding.sandbox_instance_id)
    if (result.exit_code === 8) return null
    if (result.exit_code !== 0) {
      throw new Error(
        `fly-sprites result pull failed (exit ${result.exit_code})${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
      )
    }
    const tarPath = result.stdout.trim()
    if (!/^\/tmp\/waypoint-pull-[A-Za-z0-9._-]+$/.test(tarPath)) {
      const head = result.stdout.slice(0, 64).replace(/[^\x20-\x7e]/g, '.')
      throw new Error(
        `fly-sprites result pull refused: expected a /tmp/waypoint-pull-* path on stdout, got ${result.stdout.length} bytes (head: "${head}")`,
      )
    }
    const fs = sprite.filesystem('/')
    const stat = await fs.stat(tarPath)
    const bytes = await fs.readFile(tarPath, null)
    if (typeof stat.size === 'number' && bytes.length !== stat.size) {
      throw new Error(
        `fly-sprites result pull refused: filesystem read returned ${bytes.length} bytes but the archive is ${stat.size} — refusing a partial pull`,
      )
    }
    try {
      await fs.rm(tarPath)
    } catch (error) {
      // A failure must be visible, but a leftover temp file never fails the pull.
      console.error(
        `[fly-sprites] pull temp cleanup failed on ${binding.sandbox_name} (${tarPath}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return bytes
  }

  /**
   * Delete a per-project workspace dir after its results are home
   * (delete-after-pull, L2): case files must not linger on a warm shared
   * sprite once the attempt is over. Guarded — bare `/work` refuses.
   */
  async deleteGuestWorkspace(
    binding: ProjectSandboxBinding,
    input: { readonly guestPath: string },
  ): Promise<void> {
    this.#assertProvider(binding)
    const sprite = this.#client.sprite(binding.sandbox_name)
    await this.#wipeGuestDir(sprite, input.guestPath)
    this.#stopped.delete(binding.sandbox_instance_id)
  }

  /**
   * Install the guest bundle at `guestPath` unless the CURRENT revision is
   * verifiably already there. The skip probe checks the revision marker AND
   * every required file — never the marker alone: a marker that matches over
   * a broken tree (interrupted install, partial wipe) is a crash-looping
   * guest pinned across rebuilds. Any probe miss reinstalls: wipe → extract →
   * write the marker LAST. Returns 'verified' (skipped) or 'installed'.
   */
  async ensureGuestBundle(
    binding: ProjectSandboxBinding,
    input: {
      readonly hostDist: string
      readonly guestPath: string
      readonly revision: string
      /** Guest files (relative to guestPath) whose presence the skip probe requires. */
      readonly requiredFiles: readonly string[]
    },
  ): Promise<'verified' | 'installed'> {
    this.#assertProvider(binding)
    const revision = assertRealBundleRevision(input.revision)
    const guestPath = assertWipeSafeGuestPath(input.guestPath)
    if (input.requiredFiles.length === 0) {
      throw new Error(
        'fly-sprites guest install refused: requiredFiles is empty — a marker-only skip probe cannot verify the tree',
      )
    }
    for (const rel of input.requiredFiles) {
      if (rel.startsWith('/') || rel.split('/').includes('..') || rel.includes('\n')) {
        throw new Error(`fly-sprites guest install refused: '${rel}' is not a safe bundle-relative path`)
      }
    }

    await this.#ensureNetworkPolicy(binding)
    const marker = `${guestPath}/${GUEST_REVISION_MARKER}`
    const treeChecks = input.requiredFiles
      .map((rel) => `[ -f ${shq(`${guestPath}/${rel}`)} ]`)
      .join(' && ')
    const sprite = this.#client.sprite(binding.sandbox_name)
    const probe = await this.#execFile(sprite, [
      '/bin/sh',
      '-c',
      `[ "$(cat ${shq(marker)} 2>/dev/null)" = ${shq(revision)} ] && ${treeChecks}`,
    ])
    if (probe.exit_code === 0) {
      this.#stopped.delete(binding.sandbox_instance_id)
      return 'verified'
    }

    // syncHostDirectory wipes first, so the old marker dies with the old tree;
    // a crash between wipe and stamp leaves no marker → the next ensure reinstalls.
    await this.syncHostDirectory(binding, { hostPath: input.hostDist, guestPath })
    const stamp = await this.#execFile(sprite, [
      '/bin/sh',
      '-c',
      `printf '%s' ${shq(revision)} > ${shq(marker)}`,
    ])
    if (stamp.exit_code !== 0) {
      throw new Error(`fly-sprites guest install failed: revision marker write exited ${stamp.exit_code}`)
    }
    return 'installed'
  }

  async health(binding: ProjectSandboxBinding): Promise<ProjectSandboxHealth> {
    const state = await this.inspect(binding)
    if (!state) {
      return {
        ...binding,
        status: 'unavailable',
        healthy: false,
        virtualization: 'microvm',
        observed_at: this.#iso(),
      }
    }
    const stopped = this.#stopped.has(binding.sandbox_instance_id) || state.lifecycle === 'stopped'
    return {
      ...state,
      status: stopped ? 'stopped' : state.lifecycle === 'running' ? 'healthy' : 'degraded',
      healthy: !stopped && state.lifecycle === 'running',
      virtualization: 'microvm',
      observed_at: this.#iso(),
    }
  }

  async stop(binding: ProjectSandboxBinding): Promise<void> {
    this.#assertProvider(binding)
    const local =
      this.#bindings.get(sandboxStateKey(binding)) ??
      this.#rehydrate(binding) ??
      (binding.oauth_lane_id ? null : await this.inspectByProjectId(binding.project_id))
    if (!local) throw new Error('sandbox not found')
    assertProjectSandboxBinding(local, binding)

    // End active sessions so idle hibernation can proceed. Never DELETE.
    const sprite = this.#client.sprite(binding.sandbox_name)
    await this.#killAllSessions(sprite)
    this.#stopped.add(binding.sandbox_instance_id)
    this.#bindings.set(sandboxStateKey(binding), {
      ...local,
      lifecycle: 'stopped',
      updated_at: this.#iso(),
    })
  }

  /**
   * Destroy a sprite whose PLACEMENT is sick — the one product-side
   * destruction (transport-death exhaustion; Aaron's 2026-08-30 D-B
   * amendment) — so the next create() draws a fresh placement. The
   * in-memory entry is cleared even when the API delete fails: create()
   * short-circuits on that entry, and after a recycle attempt the next
   * dispatch must re-ask the API instead of trusting a possibly-dead
   * cached state. An already-gone sprite counts as recycled.
   */
  async recycleSandbox(binding: ProjectSandboxBinding, reason: string): Promise<void> {
    this.#assertProvider(binding)
    try {
      await this.#client.deleteSprite(binding.sandbox_name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = (error as { statusCode?: number } | null)?.statusCode
      if (statusCode !== 404 && !/not found/i.test(message)) {
        throw new Error(`sprite recycle failed for ${binding.sandbox_name}: ${message}`)
      }
    } finally {
      this.#bindings.delete(sandboxStateKey(binding))
      this.#stopped.delete(binding.sandbox_instance_id)
    }
    console.error(`[fly-sprites] recycled sprite ${binding.sandbox_name}: ${reason}`)
  }

  /** Rehydrate durable host binding so verify/enter work across fresh CLI processes. */
  #rehydrate(binding: ProjectSandboxBinding): ProjectSandboxState | null {
    const durable = readSandboxState(sandboxStateKey(binding))
    if (!durable || durable.provider !== this.provider) return null
    try {
      assertProjectSandboxBinding(durable, binding)
    } catch {
      return null
    }
    this.#bindings.set(sandboxStateKey(binding), durable)
    return durable
  }

  async #ensureNetworkPolicy(binding: ProjectSandboxBinding): Promise<void> {
    // Sprites: empty rules = unrestricted egress (observed live). Fail closed —
    // never POST [] and claim deny-by-default.
    if (this.#egressAllow.length === 0) {
      throw new Error(
        "fly-sprites network policy refused: empty egress allowlist is not deny-by-default on Sprites " +
          "(fail closed; the project's runtime.sandbox.egress.allow is the only source of admitted hosts)",
      )
    }
    // L5: policy_hash is ENFORCED, not merely recorded — the digest of the
    // allowlist about to be POSTed must equal the binding's admitted hash.
    const enforced = policyHashForEgress(this.#egressAllow)
    if (enforced !== binding.policy_hash) {
      throw new Error(
        'fly-sprites network policy refused: binding policy_hash does not match the enforced egress allowlist ' +
          `(admitted ${binding.policy_hash.slice(0, 12)}…, enforcing ${enforced.slice(0, 12)}…) — ` +
          'the policy that is POSTed must be the policy that was admitted',
      )
    }
    const rules = this.#egressAllow.map((domain) => ({ action: 'allow' as const, domain }))
    const sprite = this.#client.sprite(binding.sandbox_name)
    await sprite.updateNetworkPolicy({ rules })
    const observed = await sprite.getNetworkPolicy()
    const allowed = canonicalizeSandboxEgressAllowlist(
      (observed.rules ?? [])
        .filter((rule) => rule.action === 'allow' || rule.action === undefined)
        .map((rule) => rule.domain ?? ''),
    )
    const expected = this.#egressAllow
    if (allowed.length !== expected.length || allowed.some((host, index) => host !== expected[index])) {
      throw new Error(
        'fly-sprites network policy mismatch: deny-by-default allowlist does not match binding policy (policy_hash derivation inputs)',
      )
    }
  }

  /** Guarded rm -rf: the single wipe path for syncs and deletes. */
  async #wipeGuestDir(sprite: FlySpritesSpriteLike, guestPath: string): Promise<void> {
    const safe = assertWipeSafeGuestPath(guestPath)
    const wiped = await this.#execFile(sprite, ['/bin/rm', '-rf', '--', safe])
    if (wiped.exit_code !== 0) {
      throw new Error(`fly-sprites guest wipe failed: rm -rf ${safe} exited ${wiped.exit_code}`)
    }
  }

  async #getSpriteOrNull(name: string): Promise<FlySpritesSpriteLike | null> {
    try {
      return await this.#client.getSprite(name)
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  /**
   * Short exec (mkdir, probes-by-file) with optional env, bounded by the
   * deadline. The SDK REJECTS on nonzero exit (ExecError carrying the result);
   * Waypoint's contract treats exit codes as data — probes and guards branch on
   * them — so a result-shaped rejection maps back to a normal result here.
   */
  async #execFile(
    sprite: FlySpritesSpriteLike,
    argv: readonly string[],
    env?: Readonly<Record<string, string>>,
  ): Promise<ProjectSandboxEnterResult & { stdout_bytes: Buffer }> {
    const [file, ...args] = argv
    if (!file) throw new Error('fly-sprites exec refused: empty argv')
    let result: FlySpritesExecResultLike
    try {
      result = await this.#withDeadline(
        sprite,
        file,
        sprite.execFile(file, [...args], env ? { env: { ...env } } : undefined),
      )
    } catch (error) {
      const carried = (error as { result?: { exitCode?: unknown } }).result
      if (carried && typeof carried.exitCode === 'number') {
        result = carried as FlySpritesExecResultLike
      } else {
        throw error
      }
    }
    return {
      exit_code: result.exitCode,
      stdout: bufferToUtf8(result.stdout),
      stderr: bufferToUtf8(result.stderr),
      stdout_bytes: toBuffer(result.stdout),
      observed_at: this.#iso(),
    }
  }

  /** Streaming exec (enter, tar sync, pull), bounded by the deadline. */
  async #execStream(
    sprite: FlySpritesSpriteLike,
    argv: readonly string[],
    stdin: Readable,
  ): Promise<ProjectSandboxEnterResult & { stdout_bytes: Buffer }> {
    const [file, ...args] = argv
    if (!file) throw new Error('fly-sprites exec refused: empty argv')
    const run = async (): Promise<ProjectSandboxEnterResult & { stdout_bytes: Buffer }> => {
      const cmd = sprite.spawn(file, [...args])
      await new Promise<void>((resolve, reject) => {
        cmd.once('spawn', () => resolve())
        cmd.once('error', (err) => reject(err))
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      const collectStdout = collectStream(cmd.stdout, stdoutChunks)
      const collectStderr = collectStream(cmd.stderr, stderrChunks)

      await pipeline(stdin, cmd.stdin as NodeJS.WritableStream)
      const exit = await cmd.wait()
      await Promise.all([collectStdout, collectStderr])
      const stdout_bytes = Buffer.concat(stdoutChunks)
      return {
        exit_code: exit,
        stdout: stdout_bytes.toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout_bytes,
        observed_at: this.#iso(),
      }
    }
    return this.#withDeadline(sprite, file, run())
  }

  /**
   * Host-side exec ceiling. On breach: kill the sprite's sessions (best
   * effort, so the guest side of the wedge dies too), then throw — the caller
   * fails the attempt loudly instead of hanging forever.
   */
  async #withDeadline<T>(sprite: FlySpritesSpriteLike, label: string, op: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ExecDeadlineExceeded(`deadline ${this.#deadlineMs}ms`)),
        this.#deadlineMs,
      )
      timer.unref?.()
    })
    try {
      return await Promise.race([op, deadline])
    } catch (error) {
      if (error instanceof ExecDeadlineExceeded) {
        // The losing op may still settle later; never let it surface as unhandled.
        op.catch(() => {})
        await this.#killAllSessions(sprite)
        throw new Error(
          `fly-sprites exec deadline exceeded after ${this.#deadlineMs}ms ('${label}') — sprite sessions killed; the attempt fails instead of hanging`,
        )
      }
      throw error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Best-effort: end every exec session on the sprite (stop + deadline breach). */
  async #killAllSessions(sprite: FlySpritesSpriteLike): Promise<void> {
    try {
      const sessions = await sprite.listSessions()
      for (const session of sessions) {
        if (session.id === undefined || session.id === null) continue
        const stream = await sprite.killSession(String(session.id))
        if (stream && typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
          for await (const _ of stream as AsyncIterable<unknown>) {
            /* drain progress */
          }
        }
      }
    } catch (error) {
      // Visible, never fatal: the deadline error (or stop) is the headline.
      console.error(
        `[fly-sprites] session cleanup failed on '${sprite.name}': ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  #assertProvider(binding: ProjectSandboxBinding): void {
    if (binding.provider !== this.provider) {
      throw new Error(`fly-sprites binding refused: provider is ${binding.provider}`)
    }
  }

  #iso(): string {
    return this.#now().toISOString()
  }
}

function mapSpriteLifecycle(status: string | undefined): ProjectSandboxState['lifecycle'] {
  if (status === 'running' || status === 'warm') return 'running'
  if (status === 'cold') return 'stopped'
  return 'unavailable'
}

/** SDK appends `/v1/...` itself; strip a trailing version from env/legacy bases. */
export function normalizeSdkBaseURL(apiBase: string): string {
  return apiBase.replace(/\/v1\/?$/, '').replace(/\/+$/, '') || 'https://api.sprites.dev'
}

function toIso(value: Date | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as { statusCode?: number }).statusCode
  if (status === 404) return true
  const message = err instanceof Error ? err.message : String(err)
  return /\b404\b/.test(message) || /not found/i.test(message)
}

function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value)
}

function bufferToUtf8(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value
}

async function collectStream(
  stream: AsyncIterable<unknown> | NodeJS.ReadableStream,
  into: Buffer[],
): Promise<void> {
  if (Symbol.asyncIterator in Object(stream)) {
    for await (const chunk of stream as AsyncIterable<unknown>) {
      into.push(chunkToBuffer(chunk))
    }
    return
  }
  const readable = stream as NodeJS.ReadableStream
  await new Promise<void>((resolve, reject) => {
    readable.on('data', (chunk) => into.push(chunkToBuffer(chunk)))
    readable.on('end', () => resolve())
    readable.on('error', reject)
  })
}

function chunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk ?? ''))
}
