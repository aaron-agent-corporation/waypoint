import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isProductionSandboxBackend, type WaypointProjectRootConfig, type WaypointProjectSandboxConfig } from '../project/config.ts'
import { claimHostPath, claimRelPath, readSandboxClaim, toSandboxPath } from '../sandbox/claim.ts'
import { sandboxEnabledForProject } from '../sandbox/gate.ts'
import { DEFAULT_MOUNT_PATH, orderHostPath } from '../sandbox/runtime.ts'
import { guestWorkspacePath, type ProjectSandboxBinding, type ProjectSandboxProvider } from '../sandbox/provider.ts'
import {
  CORDIS_GUEST_DIST_ENV,
  cordisGuestDistRefusal,
  resolveCordisGuestDist,
} from '../sandbox/cordis-guest-dist.ts'
import {
  buildCloudEnterArgv,
  projectSandboxBindingFromManagedRoute,
  realizeOauthLaneBinding,
  resolveManagedSandboxProvider,
  type ManagedRouteSandboxMetadata,
} from './managed-cloud-sandbox.ts'
import { pullManagedResultsAfterEnter, stageManagedWorkspaceForEnter } from './managed-workspace-sync.ts'
import { resolveLaneBrokeredCredential } from './lane-cred-broker.ts'
import {
  clearLaneCredentialRefusal,
  laneCredentialRefusalFromCloseReason,
  laneQuotaHoldFromCloseReason,
  recordLaneCredentialRefusal,
} from '../sandbox/lane-credential-health.ts'
import { spriteTransportDeathFromCloseReason } from '../sandbox/sprite-recycle.ts'
import { staleDuplicateNote } from '../sandbox/lane-credential-duplicates.ts'
import { BROKER_FILE_ENV } from './pi-cred-broker.ts'
import { cordisScratchDir } from './cordis/compose.ts'
import type { CordisRecipeRuntimeInput, CordisRecipeRuntimeOutput, CordisRecipeRuntimeStatus } from './cordis-runtime.ts'
import type { CordisWorkOrder } from './cordis-worker-entry.ts'
import type { RecipeModelClass } from './work-order.ts'

/**
 * Cordis workers in fly-sprites VMs (S1, docs/designs/sprite-worker-isolation.md).
 * When the project configures `runtime.sandbox` with a cloud backend, the
 * bridge stays home: it stages the work order and brokered credential, syncs
 * the workspace over the Sprites API, and enters via
 * `ProjectSandboxProvider.enter` — the guest runs the baked Cordis bundle
 * (cordis-worker-entry), never a third-party harness.
 *
 * The BINDING is Waypoint's divergence from the Waypoint guide: PR stamps
 * route metadata per dispatch; Waypoint's sprite is warm-per-project. The
 * provisioning record (`.waypoint/sandbox/binding.json`) is stamped onto the
 * DURABLE ROUTE ROW at start (S2, item 52) and the bridge threads the row's
 * copy in on config, so a route runs under the binding it started with; the
 * file remains the fallback for callers without a durable row. Every
 * authority-bearing field must be present — never inferred from cwd.
 *
 * CREDENTIALS (L4, docs/designs/sprite-lane-conversion.md): the worker
 * brokers the PICKED lane's credential (`config.lane` → lane-cred-broker) —
 * the shared pi store is the brain's account and is never read on this path.
 * The blob rides the stdin-streamed workspace tar as a staged file; the enter
 * argv (which traverses the Sprites WebSocket URL) carries only its path.
 * The S1-era whole-home credential sync is retired: the blob is the one
 * guest credential.
 */

/** Where the guest install bakes the LAUNCHER (deploy/sandbox/cordis-worker-guest).
 *  The launcher — not the bundle — is the enter argv: it calls the bundle's
 *  exported main explicitly, so no bundled CLI's argv[1] main-guard ever fires. */
export const CORDIS_GUEST_ENTRY = '/opt/cordis-worker/cordis-worker-launch.mjs'
/** The baked worker MCP server beside it — the closed tool surface in-guest. */
export const CORDIS_GUEST_TOOL_SERVER = '/opt/cordis-worker/worker-mcp-server.mjs'
/** Where the guest bundle installs inside the sprite. */
export const CORDIS_GUEST_INSTALL_PATH = '/opt/cordis-worker'
/** Files the tree-verifying ensure requires (mirrors provision-sprite). */
export const CORDIS_GUEST_REQUIRED_FILES = [
  'cordis-worker-launch.mjs',
  'cordis-worker.mjs',
  'worker-mcp-server.mjs',
] as const
/** Host dir of the built guest bundle (…/cordis-worker-guest/dist). When set,
 *  the lane path ensures the bundle at dispatch — a lane sprite is created
 *  bare, and provisioning no longer fronts for it (L5). */
export { CORDIS_GUEST_DIST_ENV } from '../sandbox/cordis-guest-dist.ts'

/**
 * Every pre-enter refusal starts with this — no sprite was entered, no model
 * was called, no worker ran. The retry ladder keys on it (route-014,
 * 2026-08-31): infrastructure backpressure re-queues WITHOUT charging a task
 * attempt, where a burned attempt plus the same-reason brake killed a route
 * in ten minutes while the fleet was busy recycling sick placements.
 */
export const CORDIS_INFRA_REFUSAL_PREFIX = 'sandbox refused the cordis attempt (no enter)'

/** fly-sprites' tree-verifying installer — not part of the provider interface. */
type GuestBundleEnsurer = {
  ensureGuestBundle(
    binding: ProjectSandboxBinding,
    input: {
      readonly hostDist: string
      readonly guestPath: string
      readonly revision: string
      readonly requiredFiles: readonly string[]
    },
  ): Promise<'verified' | 'installed'>
}

export interface CordisJailedTarget {
  readonly provider: string
  readonly model: string
  readonly modelClass: RecipeModelClass
}

/** The picked lane a cloud cordis worker brokers its credential from (L4). */
export interface CordisWorkerLane {
  /** Console subscription provider ('codex' | 'kimi' | 'grok'). */
  readonly consoleProvider: string
  /** The lane's subscription home on the host. */
  readonly homePath: string
}

/**
 * A lane the dispatch-time picker returned (L5): credential source PLUS the
 * lane's sprite identity and the HELD advisory lock. The runtime adopts the
 * lock — release() runs in a finally on every exit path and is never
 * re-acquired (the self-deadlock trap).
 */
export interface CordisPickedLane {
  /** Opaque lane id (`sub:<home-dir-name>`) — lock key + sprite-name input. */
  readonly oauth_lane_id: string
  /** DNS-safe provider slug for the lane sprite name (e.g. 'codex'). */
  readonly oauth_provider_slug: string
  readonly consoleProvider: string
  readonly homePath: string
  /** How long the dispatch waited for the lane lock. */
  readonly queue_wait_ms: number
  /** Release the HELD lane lock. */
  release(): Promise<void>
}

export type CordisLanePickResult =
  | { readonly ok: true; readonly lane: CordisPickedLane }
  | { readonly ok: false; readonly reason: string }

/**
 * Dispatch-time lane picker seam (L5). Invoked AFTER model resolution — the
 * resolved target names the pi provider the lane must serve. The bridge builds
 * this from the Console subscription homes + pg session lane locks + the
 * brain-reserve holdout; tests inject stubs.
 */
export type CordisLanePicker = (target: CordisJailedTarget) => Promise<CordisLanePickResult>

export interface CordisJailedConfig {
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  readonly sandbox: WaypointProjectSandboxConfig
  /** The per-project provisioning record (ManagedRouteSandboxMetadata shape). */
  readonly managedBinding?: unknown
  readonly sandboxProvider?: ProjectSandboxProvider
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly maxTurns?: number
  /**
   * The PICKED worker lane (L4): its home is the ONLY credential source on
   * this path. The shared pi store is the brain's account and is never read
   * here — brain/worker exclusivity is structural, not policed. L5 feeds
   * this from the dispatch-time picker.
   */
  readonly lane?: CordisWorkerLane
  /**
   * Dispatch-time lane picker (L5). When present it supersedes `lane`: the
   * runtime picks after model resolution, realizes the LANE sprite binding
   * (`realizeOauthLaneBinding`), and releases the held lock on every exit.
   */
  readonly lanePicker?: CordisLanePicker
  /** Test seam: guest bundle path inside the sprite. */
  readonly guestEntry?: string
  /** Test seam: guest MCP server path inside the sprite. */
  readonly guestToolServer?: string
}

export type CordisManagedEnterPlan =
  | {
      readonly ok: true
      readonly argv: readonly string[]
      readonly order: CordisWorkOrder
      readonly provider: ProjectSandboxProvider
      readonly binding: ProjectSandboxBinding
      /** The guest workspace the attempt runs in (per-project slug dir on fly-sprites). */
      readonly mountPath: string
    }
  | { readonly ok: false; readonly reason: string }

export async function prepareCordisManagedEnter(
  input: CordisRecipeRuntimeInput,
  target: CordisJailedTarget,
  config: CordisJailedConfig,
  pickedLane?: CordisPickedLane,
): Promise<CordisManagedEnterPlan> {
  const sandbox = config.sandbox
  const mountBase = sandbox.mount_path ?? DEFAULT_MOUNT_PATH

  if (!config.lane) {
    return {
      ok: false,
      reason:
        `cloud cordis workers broker the picked lane's credential — no worker lane was provided for ` +
        `provider '${target.provider}' (the shared pi store is the brain's account and is never read ` +
        `on the worker path; sign in a worker subscription and let the dispatch-time picker choose it)`,
    }
  }
  // Host-side refresh + persist happens HERE, under the held lane lock (the
  // picker hands the lock in and the runtime holds it until every exit path):
  // the broker is the lane home's writer, and the pg session lock is what
  // serializes writers across bridge processes and products. The guest gets a
  // short-lived ACCESS-ONLY blob — a rotated refresh token that reached the
  // guest would die there with its in-memory store and burn the lane
  // (docs/ERRORS-AND-FIXES.md 2026-08-29).
  const derived = await resolveLaneBrokeredCredential({
    piProvider: target.provider,
    consoleProvider: config.lane.consoleProvider,
    homePath: config.lane.homePath,
  })
  if (!derived.ok) {
    // An ACCOUNT refusal takes the lane out of the pool until it re-auths, so
    // the next dispatch picks a healthy lane instead of re-failing on this one
    // (item 54: one lapsed lane at the head of the sorted candidates absorbed
    // 12 of 21 attempts). A transport or persist failure never marks a lane.
    // A rotating credential has ONE live copy: when the same account is signed
    // in somewhere else on this machine, that refresh invalidated ours. Say so
    // — otherwise a stale duplicate reads as a lapsed account and the operator
    // re-auths into a copy that will die again (item 54).
    const duplicate = staleDuplicateNote(config.lane.homePath)
    const problem = duplicate ? `${derived.problem}. NOTE: ${duplicate}` : derived.problem
    if (derived.laneUnusable && pickedLane) {
      recordLaneCredentialRefusal(pickedLane.oauth_lane_id, problem, {
        homePath: config.lane.homePath,
        ...(config.env ? { env: config.env } : {}),
      })
    }
    return { ok: false, reason: `worker lane credential refused: ${problem}` }
  }
  // Authenticated: a lane held out by an earlier refusal is healthy again.
  if (pickedLane) {
    clearLaneCredentialRefusal(pickedLane.oauth_lane_id, {
      ...(config.env ? { env: config.env } : {}),
    })
  }
  const blob = derived.blob

  const managedMeta =
    config.managedBinding && typeof config.managedBinding === 'object'
      ? (config.managedBinding as ManagedRouteSandboxMetadata)
      : ({} as ManagedRouteSandboxMetadata)
  const fallbackProvider = isProductionSandboxBackend(sandbox.backend) ? sandbox.backend : undefined

  // L5: a PICKED lane binds to the LANE's sprite at dispatch time — the route
  // stamp supplies the admission context only, never a per-project sprite
  // identity. Without a picked lane, the S2-era per-project stamp still binds.
  let provider: ProjectSandboxProvider
  let binding: ProjectSandboxBinding
  try {
    if (pickedLane) {
      const providerKind = managedMeta.sandbox_provider ?? fallbackProvider
      if (typeof providerKind !== 'string' || providerKind.trim() === '') {
        throw new Error('managed sandbox binding refused: missing sandbox_provider')
      }
      provider = resolveManagedSandboxProvider(
        { sandboxProvider: config.sandboxProvider },
        sandbox,
        providerKind.trim(),
      )
      binding = await realizeOauthLaneBinding({
        provider,
        managed: managedMeta,
        projectRoot: input.projectRoot,
        lane: {
          oauth_lane_id: pickedLane.oauth_lane_id,
          oauth_provider_slug: pickedLane.oauth_provider_slug,
        },
      })
      // A lane sprite is created BARE — ensure the guest bundle before any
      // sync/enter. The bundle this host installs must be the admitted one:
      // a digest drift refuses rather than running un-admitted code under an
      // admitted image_digest.
      //
      // This used to skip SILENTLY when the env var was unset, on the theory
      // that a warm sprite still carries its provisioned bundle. It does not:
      // every dispatch of item 54's route-003 entered a bare lane sprite and
      // died in-guest on `Cannot find module` — a message naming nothing an
      // operator can act on, from bridges launchd spawns without the variable.
      // A provider that CAN install the bundle and a host that cannot find it
      // is now a refusal that says where to put it.
      const ensurer = provider as Partial<GuestBundleEnsurer>
      const canEnsure = typeof ensurer.ensureGuestBundle === 'function'
      const guestDistResolution = resolveCordisGuestDist(config.env ?? process.env)
      const guestDist = guestDistResolution.dist
      if (canEnsure && !guestDist) {
        throw new Error(cordisGuestDistRefusal(guestDistResolution.searched))
      }
      if (guestDist && canEnsure) {
        const revision = (await readFile(join(guestDist, 'digest.txt'), 'utf8')).trim()
        if (revision !== binding.image_digest) {
          throw new Error(
            `guest bundle drift: ${CORDIS_GUEST_DIST_ENV} digest ${revision} does not match the ` +
              `route-stamped image_digest ${binding.image_digest} — rebuild the guest bundle or re-admit ` +
              'before dispatching',
          )
        }
        // The stamp only proves route-start and dispatch read the same host
        // state; the ADMISSION is the authority on which bundle may run
        // (route-013, 2026-08-31: a stale stamp refused a properly admitted
        // bundle — the inverse, an admitted stamp over an un-admitted bundle,
        // must refuse here, not ride through).
        const admitted = (provider as { admission?: { admitted_image_digest?: string } }).admission
          ?.admitted_image_digest
        if (typeof admitted === 'string' && admitted !== revision) {
          throw new Error(
            `guest bundle is not the admitted one: the host holds ${revision}, but the admission record pins ` +
              `${admitted} — install the admitted bundle, or qualify and record this one before dispatching`,
          )
        }
        await ensurer.ensureGuestBundle!(binding, {
          hostDist: guestDist,
          guestPath: CORDIS_GUEST_INSTALL_PATH,
          revision,
          requiredFiles: CORDIS_GUEST_REQUIRED_FILES,
        })
      }
    } else {
      binding = projectSandboxBindingFromManagedRoute(managedMeta, input.projectRoot, fallbackProvider)
      provider = resolveManagedSandboxProvider(
        { sandboxProvider: config.sandboxProvider },
        sandbox,
        binding.provider,
      )
    }
  } catch (error) {
    return {
      ok: false,
      reason: `${CORDIS_INFRA_REFUSAL_PREFIX}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // L2 hygiene: on a shared sprite every project lives in its own slug dir
  // under the mount base — synced, run, and wiped strictly inside it.
  const mountPath =
    binding.provider === 'fly-sprites' ? guestWorkspacePath(mountBase, binding.project_id) : mountBase

  const scratchDir = cordisScratchDir(input.projectRoot, input.routeId, input.taskId)
  if (input.priorAttempt !== undefined) await rm(scratchDir, { recursive: true, force: true })
  await mkdir(scratchDir, { recursive: true })

  const order: CordisWorkOrder = {
    routeId: input.routeId,
    taskId: input.taskId,
    recipe: input.recipe,
    prompt: input.prompt,
    projectRoot: mountPath,
    modelClass: target.modelClass,
    provider: target.provider,
    model: target.model,
    ...(input.access ? { access: input.access } : {}),
    ...(input.outputArtifacts ? { outputArtifacts: input.outputArtifacts } : {}),
    ...(input.fanoutItem ? { fanoutItem: input.fanoutItem } : {}),
    ...(config.roots ? { roots: config.roots } : {}),
    toolServer: config.guestToolServer ?? CORDIS_GUEST_TOOL_SERVER,
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
  }

  // Staged BEFORE the workspace sync so the tar carries it into the mount.
  const workOrderJson = JSON.stringify(order)
  await writeFile(orderHostPath(scratchDir), workOrderJson, 'utf8')

  const claimFile = claimHostPath(input.projectRoot, input.routeId, input.taskId)
  if (input.priorAttempt !== undefined) await rm(claimFile, { force: true })
  await mkdir(join(input.projectRoot, '.waypoint', 'claims', input.routeId), { recursive: true })

  const orderSandboxPath = toSandboxPath(input.projectRoot, orderHostPath(scratchDir), mountPath)

  // L4 residency: the credential VALUE rides the stdin-streamed tar leg as a
  // staged file — enter argv (which traverses the Sprites WebSocket URL)
  // carries only its PATH. The guest reads-and-unlinks its copy; the host
  // copy is written immediately before the sync and removed the moment the
  // sync has streamed (or refused) it, so it outlives nothing.
  const credentialHostPath = join(scratchDir, 'brokered-cred.json')
  const credentialSandboxPath = toSandboxPath(input.projectRoot, credentialHostPath, mountPath)
  await writeFile(credentialHostPath, blob, { mode: 0o600 })
  try {
    await stageManagedWorkspaceForEnter(provider, binding, input.projectRoot, mountPath)
  } catch (error) {
    return {
      ok: false,
      reason: `${CORDIS_INFRA_REFUSAL_PREFIX}: workspace sync failed — ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    await rm(credentialHostPath, { force: true })
  }

  // Only the credential file's PATH rides the enter argv — never the value,
  // and never a whole subscription home (the S1-era home sync is retired: the
  // brokered blob is the one guest credential).
  const guestEnv: Readonly<Record<string, string>> = { [BROKER_FILE_ENV]: credentialSandboxPath }

  let enterArgv: string[]
  try {
    enterArgv = buildCloudEnterArgv({
      agentArgv: ['node', config.guestEntry ?? CORDIS_GUEST_ENTRY],
      mountPath,
      orderSandboxPath,
      workOrderVia: 'stdin',
      workOrder: workOrderJson,
      guestEnv,
    })
  } catch (error) {
    return {
      ok: false,
      reason: `${CORDIS_INFRA_REFUSAL_PREFIX}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { ok: true, argv: enterArgv, order, provider, binding, mountPath }
}

/**
 * Run a cordis recipe inside a fly-sprites VM. Fails closed when the sandbox is
 * disabled by env or the managed enter is refused — a refusal never falls back
 * to an unjailed local run from here.
 */
export async function runCordisJailed(
  input: CordisRecipeRuntimeInput,
  target: CordisJailedTarget,
  config: CordisJailedConfig,
): Promise<CordisRecipeRuntimeOutput> {
  const hostEnv = config.env ?? process.env
  if (!sandboxEnabledForProject(config.sandbox, hostEnv)) {
    return buildJailedOutput(input, target, 'failed', null, 'cordis sandbox is disabled (WAYPOINT_SANDBOX=off) — fail closed')
  }

  // L5: pick the lane at dispatch time — the target is already model-resolved,
  // so the picker knows which pi provider the lane must serve. The pick is a
  // HELD lock: adopt it, run, and release in a finally on EVERY exit path.
  if (!config.lanePicker) return runCordisJailedEntered(input, target, config, undefined)
  const picked = await config.lanePicker(target)
  if (!picked.ok) return buildJailedOutput(input, target, 'failed', null, picked.reason)
  const lane = picked.lane
  try {
    return await runCordisJailedEntered(
      input,
      target,
      { ...config, lane: { consoleProvider: lane.consoleProvider, homePath: lane.homePath } },
      lane,
    )
  } finally {
    try {
      await lane.release()
    } catch (error) {
      // The pg session lock self-releases when the bridge session ends; an
      // explicit release failure must still be visible, never swallowed.
      console.error(
        `[cordis-jailed] lane lock release failed for ${lane.oauth_lane_id}: ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }
}

async function runCordisJailedEntered(
  input: CordisRecipeRuntimeInput,
  target: CordisJailedTarget,
  config: CordisJailedConfig,
  lane: CordisPickedLane | undefined,
): Promise<CordisRecipeRuntimeOutput> {
  const buildOutput = (
    status: CordisRecipeRuntimeStatus,
    report: Record<string, unknown> | null,
    closeReason: string,
    binding?: ProjectSandboxBinding,
  ) => buildJailedOutput(input, target, status, report, closeReason, binding, lane)

  const plan = await prepareCordisManagedEnter(input, target, config, lane)
  if (!plan.ok) return buildOutput('failed', null, plan.reason)

  let enterResult
  try {
    enterResult = await plan.provider.enter(plan.binding, { argv: plan.argv })
  } catch (error) {
    return buildOutput(
      'failed',
      null,
      `sandbox enter failed: ${error instanceof Error ? error.message : String(error)}`,
      plan.binding,
    )
  }

  if (input.signal?.aborted) {
    return buildOutput('stopped', null, 'run aborted; the sprite session was killed', plan.binding)
  }

  // Bring the results home: the claim plus the task's rw-granted roots — the
  // write jail enforced on the return leg. A pull failure is a FAILED attempt,
  // never a quiet read of an absent host claim.
  try {
    const rwRoots = Object.entries(config.roots ?? {})
      .filter(([name, root]) => root.access === 'rw' && (input.access?.[name] ?? 'ro') === 'rw')
      .map(([, root]) => root.path)
    await pullManagedResultsAfterEnter(plan.provider, plan.binding, input.projectRoot, plan.mountPath, [
      claimRelPath(input.routeId, input.taskId),
      ...rwRoots,
    ])
  } catch (error) {
    return buildOutput(
      'failed',
      null,
      `result pull failed after enter: ${error instanceof Error ? error.message : String(error)}`,
      plan.binding,
    )
  }

  const claim = await readSandboxClaim(input.projectRoot, input.routeId, input.taskId)
  if (enterResult.exit_code !== 0) {
    const closeReason = `jailed cordis worker exited ${enterResult.exit_code}${enterResult.stderr ? `: ${enterResult.stderr.trim()}` : ''}`
    // Account-level refusals surface INSIDE the guest — a server-side-dead
    // token passes the broker (route-006), and a spent quota window passes
    // everything (route-008). Without this, the refused lane is the fastest
    // lane and absorbs the route while healthy lanes idle. Quota holds carry
    // their own expiry (the account heals by waiting); credential holds
    // self-clear when a re-auth changes the home's fingerprint.
    if (lane) {
      const quota = laneQuotaHoldFromCloseReason(closeReason)
      const refusal = quota?.message ?? laneCredentialRefusalFromCloseReason(closeReason)
      if (refusal) {
        const duplicate = quota ? undefined : staleDuplicateNote(lane.homePath)
        const problem = duplicate ? `${refusal}. NOTE: ${duplicate}` : refusal
        recordLaneCredentialRefusal(lane.oauth_lane_id, problem, {
          homePath: lane.homePath,
          ...(quota ? { heldUntil: quota.heldUntil } : {}),
          ...(config.env ? { env: config.env } : {}),
        })
        console.error(
          `[cordis-jailed] lane ${lane.oauth_lane_id} held out of the pool: ${problem}`,
        )
      }
    }
    // A turn whose EVERY transport attempt died marks the PLACEMENT, not the
    // account (credential/quota text never carries the exhaustion suffix):
    // recycle the sprite so the next dispatch draws fresh (Aaron's 2026-08-30
    // D-B amendment). A recycle failure is loud but never masks the close.
    const transportDeath = spriteTransportDeathFromCloseReason(closeReason)
    if (transportDeath && typeof plan.provider.recycleSandbox === 'function') {
      try {
        await plan.provider.recycleSandbox(plan.binding, transportDeath)
        console.error(
          `[cordis-jailed] sprite ${plan.binding.sandbox_name} recycled after transport-death exhaustion — next dispatch draws a fresh placement`,
        )
      } catch (error) {
        console.error(
          `[cordis-jailed] sprite recycle FAILED (dispatch close reason unchanged): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return buildOutput('failed', claim, closeReason, plan.binding)
  }
  if (claim === null) {
    return buildOutput(
      'failed',
      null,
      'the jailed cordis worker exited 0 but wrote no report claim',
      plan.binding,
    )
  }
  const status = typeof claim.status === 'string' ? claim.status : null
  if (status !== 'finished') {
    const summary = typeof claim.summary === 'string' ? `: ${claim.summary}` : ''
    return buildOutput(
      'failed',
      claim,
      `jailed cordis worker reported '${status ?? 'unknown'}'${summary}`,
      plan.binding,
    )
  }
  const summary = typeof claim.summary === 'string' && claim.summary !== '' ? claim.summary : 'finished'
  return buildOutput('finished', claim, summary, plan.binding)
}

function buildJailedOutput(
  input: CordisRecipeRuntimeInput,
  target: CordisJailedTarget,
  status: CordisRecipeRuntimeStatus,
  report: Record<string, unknown> | null,
  closeReason: string,
  binding?: ProjectSandboxBinding,
  lane?: CordisPickedLane,
): CordisRecipeRuntimeOutput {
  return {
    status,
    runtime: 'cordis',
    recipe: input.recipe.slug,
    task_id: input.taskId,
    route_id: input.routeId,
    report,
    close_reason: closeReason,
    provider: target.provider,
    model: target.model,
    // The guest composes; the host never observes its digest in S1. Null is
    // the honest value — "not observed", never a fabricated fingerprint.
    composition_digest: null,
    blocked_tools: [],
    // S2: which sandbox the attempt entered — the admitted binding, once
    // admission produced one. Refusals BEFORE admission carry null: there was
    // no sandbox on the attempt, and inventing one would be a fabricated
    // provenance claim.
    sandbox:
      binding === undefined
        ? null
        : {
            provider: binding.provider,
            project_id: binding.project_id,
            sandbox_instance_id: binding.sandbox_instance_id,
            sandbox_name: binding.sandbox_name,
            image_digest: binding.image_digest,
            policy_hash: binding.policy_hash,
            mount_hash: binding.mount_hash,
            generation: binding.generation,
            workspace_id: binding.workspace_id,
            // L5: which LANE served the attempt, and how long the dispatch
            // queued for its lock — evidence for the scale proof (item 54).
            ...(binding.oauth_lane_id ? { oauth_lane_id: binding.oauth_lane_id } : {}),
            ...(binding.oauth_provider_slug ? { oauth_provider_slug: binding.oauth_provider_slug } : {}),
            ...(lane ? { queue_wait_ms: lane.queue_wait_ms } : {}),
          },
  }
}
