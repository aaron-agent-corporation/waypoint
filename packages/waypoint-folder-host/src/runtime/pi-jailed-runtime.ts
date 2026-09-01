import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readSandboxClaim } from '../sandbox/claim.ts'
import { sandboxEnabledForProject } from '../sandbox/gate.ts'
import { DEFAULT_MOUNT_PATH, prepareSandboxedRun } from '../sandbox/runtime.ts'
import { prepareSeatbeltJail, seatbeltEnabledForProject } from '../seatbelt/jail.ts'
import type { WaypointProjectPiPolicyRule, WaypointProjectRootConfig, WaypointProjectSandboxConfig } from '../project/config.ts'
import { BROKER_ENV, readBrokeredCredential } from './pi-cred-broker.ts'
import type { PiRecipeRuntimeInput, PiRecipeRuntimeOutput, PiRecipeRuntimeStatus } from './pi-runtime.ts'
import type { PiWorkOrder } from './pi-worker-entry.ts'
import { buildWorkerEnv } from './worker-env.ts'
import { runWorkerCommand, type WorkerCommandResult } from './worker-spawn.ts'
import type { RecipeModelClass } from './work-order.ts'

/**
 * The JAILED pi worker path (rsc-0fx, decision A′). When a pi recipe grants an
 * access-map fs tool, the loop is NOT run in-process — the host spawns the
 * {@link import('./pi-worker-entry.ts')} child inside the SAME Seatbelt write jail
 * a `claude -p` worker gets (kernel-enforced write confinement), with the model
 * credential BROKERED in via the env (pi-cred-broker.ts) rather than mounting
 * `~/.pi`. The in-process `PathGuard` fs tools survive as the inner layer inside
 * the child; the OS jail is the outer layer.
 *
 * This reuses the worker-runtime primitives wholesale — `prepareSeatbeltJail`,
 * `buildWorkerEnv`, `runWorkerCommand`, the rsc-452 file claim — so there is no
 * second copy of the security-critical jail/spawn logic. Outcome is
 * process-exit × the claim, exactly as the `claude -p` path derives it.
 *
 * TWO TIERS, chosen by config (runPiJailed branches):
 *
 *  - SEATBELT (macOS host; reads + network open, writes confined) — the default
 *    jail. preparePiJailedSpawn assembles it; the credential is brokered into the
 *    child env (BROKER_ENV) and the write jail is the Seatbelt profile.
 *  - MICROSANDBOX (a Linux microVM; default-deny egress, reads isolated to the
 *    mounted case tree, writes confined) — when the project configures
 *    runtime.sandbox. preparePiSandboxedSpawn assembles it: the case tree
 *    compiles to mounts (assembleSandboxMounts), the pi worker runs from the
 *    image-baked bundle (`/opt/pi-worker/pi-worker.mjs`,
 *    deploy/sandbox/pi-worker-image), and the order speaks GUEST coordinates
 *    (projectRoot = mount path).
 *
 * CREDENTIAL POSTURE, microsandbox tier — deliberately NOT the claude path's
 * `--secret ENV@HOST` network-boundary injection. pi authenticates IN-PROCESS
 * (it holds the OAuth blob and refreshes it), so msb cannot inject a bearer at
 * the network edge on pi's behalf. The brokered blob is delivered into the guest
 * env via `credential.passthrough.env` (the sanctioned subscription/OAuth
 * mechanism — see config.ts WaypointProjectSandboxPassthroughConfig, which names
 * Codex/Grok). The wall is then the EGRESS ALLOWLIST, not host-binding: a worker
 * holding a token it can only send to the one allowed provider has nowhere to
 * leak it. sandbox/gate.ts enforces default:deny + a provider host in `allow`.
 *
 * CLAIM, microsandbox tier: the pi worker writes its claim to
 * `/work/.waypoint/claims/<route>/<task>.json` (claimHostPath under the guest
 * projectRoot = mount path), which reaches the host through the mount, exactly as
 * the claude sandbox path does. The claim dir is mounted rw EXPLICITLY (rsc-clm —
 * `prepareSandboxedRun`/`assembleSandboxMounts`), the same explicit grant the
 * seatbelt jail gives, so filing the claim never depends on the access map
 * granting a broad rw root that happens to cover `.waypoint/claims`.
 */

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/** Where the pi worker image bakes the bundled worker entry (see
 *  deploy/sandbox/pi-worker-image). The guest runs `node <this>`. */
const PI_GUEST_ENTRY = '/opt/pi-worker/pi-worker.mjs'

export interface PiJailedTarget {
  readonly provider: string
  readonly model: string
  readonly modelClass: RecipeModelClass
}

export interface PiJailedConfig {
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  readonly sandbox?: WaypointProjectSandboxConfig
  /** Config-driven DENY rules forwarded into the jailed child (rsc-bhc part 3). */
  readonly piPolicy?: readonly WaypointProjectPiPolicyRule[]
  readonly env?: NodeJS.ProcessEnv
  readonly envAllow?: readonly string[]
  readonly timeoutMs?: number
  /** Test seam: where the brokered credential is read from (default `~/.pi/agent/auth.json`). */
  readonly authPath?: string
  /** Test seam: the pi child entrypoint (default resolved next to this module). */
  readonly entryPath?: string
  /** Test seam: the node binary (default `process.execPath`). */
  readonly execPath?: string
  /** Test seam: the `msb` binary (default the bundled pin; see sandbox/runtime.ts). */
  readonly msbCommand?: string
  /** The pi worker bundle path INSIDE the guest image (microsandbox path). The
   *  worker image bakes it at `/opt/pi-worker/pi-worker.mjs`
   *  (deploy/sandbox/pi-worker-image). Test seam. */
  readonly guestEntry?: string
}

export type PiJailedSpawnPlan =
  | {
      readonly ok: true
      readonly argv: readonly string[]
      readonly stdin: string
      readonly env: NodeJS.ProcessEnv
    }
  | { readonly ok: false; readonly reason: string }

export type PiSandboxedSpawnPlan =
  | {
      readonly ok: true
      /** The full `msb run …` argv (the order is staged into the mount, not piped). */
      readonly argv: readonly string[]
      /** The env msb is spawned with — carries the brokered blob by reference. */
      readonly spawnEnv: NodeJS.ProcessEnv
      /** The guest-coordinate work order that was staged (test visibility). */
      readonly order: PiWorkOrder
    }
  | { readonly ok: false; readonly reason: string }

function childEntry(config: PiJailedConfig): string {
  return config.entryPath ?? fileURLToPath(new URL('./pi-worker-entry.ts', import.meta.url))
}

/**
 * Assemble the SEATBELT jailed spawn (no spawn performed) — testable in
 * isolation. Fails CLOSED exactly where the `claude -p` jail refuses to spawn: a
 * configured microsandbox (which is the OTHER prep — preparePiSandboxedSpawn — so
 * a sandbox config reaching HERE is a caller error), no write jail available, no
 * credential to broker, or a jail that will not compile (e.g. no access map). A
 * fail-closed plan is never a fallback to an unjailed run.
 */
export async function preparePiJailedSpawn(
  input: PiRecipeRuntimeInput,
  target: PiJailedTarget,
  config: PiJailedConfig,
): Promise<PiJailedSpawnPlan> {
  const hostEnv = config.env ?? process.env

  // This is the SEATBELT prep. runPiJailed routes a configured microsandbox to
  // preparePiSandboxedSpawn before reaching here, so a sandbox config at this
  // point is a caller error — refuse rather than silently run the seatbelt path
  // (a weaker jail than the project asked for) or unjailed (fail-OPEN).
  if (config.sandbox !== undefined && sandboxEnabledForProject(config.sandbox, hostEnv)) {
    return { ok: false, reason: 'preparePiJailedSpawn is the seatbelt prep; a configured microsandbox must go through preparePiSandboxedSpawn — fail closed, no unjailed run' }
  }
  // The write jail must be available. Absent (no roots, WAYPOINT_SEATBELT off) a
  // fs-tool pi worker cannot be confined — fail closed rather than run in-process
  // on the software boundary alone (that is exactly what A′ removes).
  if (!seatbeltEnabledForProject(config.roots, hostEnv)) {
    return { ok: false, reason: 'pi fs tools require the write jail, but the project declares no roots and WAYPOINT_SEATBELT is off — fail closed' }
  }

  // Broker the model credential host-side. No credential = no auth to hand the
  // jailed child = fail closed (parity with the in-process `hasConfiguredAuth`).
  const blob = await readBrokeredCredential(target.provider, config.authPath)
  if (blob === undefined) {
    return { ok: false, reason: `provider '${target.provider}' has no stored credential to broker into the jail (run: pi /login)` }
  }

  const scratchDir = join(input.projectRoot, '.waypoint', 'scratch', input.routeId, input.taskId)
  const tmpDir = join(input.projectRoot, '.waypoint', 'tmp', input.routeId, input.taskId)
  const claimDir = join(input.projectRoot, '.waypoint', 'claims', input.routeId)
  // A retry starts from clean write roots so a failed attempt's stale artifacts
  // cannot be admitted as this attempt's (mirrors worker-runtime.ts).
  if (input.priorAttempt !== undefined) {
    await rm(scratchDir, { recursive: true, force: true })
    await rm(tmpDir, { recursive: true, force: true })
  }
  await mkdir(scratchDir, { recursive: true })
  await mkdir(tmpDir, { recursive: true })
  await mkdir(claimDir, { recursive: true })

  let wrapArgv: (argv: readonly string[]) => string[]
  try {
    const jail = await prepareSeatbeltJail({
      projectRoot: input.projectRoot,
      roots: config.roots,
      access: input.access,
      scratchDir,
      tmpDir,
      claimDir,
      name: `pi-${input.routeId}-${input.taskId}`,
    })
    wrapArgv = jail.wrapArgv
  } catch (error) {
    return { ok: false, reason: `seatbelt jail refused the pi attempt (no spawn): ${error instanceof Error ? error.message : String(error)}` }
  }

  const order: PiWorkOrder = {
    routeId: input.routeId,
    taskId: input.taskId,
    recipe: input.recipe,
    prompt: input.prompt,
    projectRoot: input.projectRoot,
    ...(input.modelClass ? { modelClass: input.modelClass } : {}),
    provider: target.provider,
    model: target.model,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.access ? { access: input.access } : {}),
    ...(config.roots ? { roots: config.roots } : {}),
    ...(config.piPolicy ? { piPolicy: config.piPolicy } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
  }

  const execPath = config.execPath ?? process.execPath
  const argv = wrapArgv([execPath, '--experimental-strip-types', '--disable-warning=ExperimentalWarning', childEntry(config)])

  // Allowlisted env (rsc-m8x) plus the brokered credential, set AFTER the
  // allowlist (it is not in the host env — it is computed here). TMPDIR is
  // redirected into the jail, as on the claude path.
  const env = buildWorkerEnv(hostEnv, [...(config.envAllow ?? []), BROKER_ENV])
  env[BROKER_ENV] = blob
  env.TMPDIR = tmpDir

  return { ok: true, argv, stdin: JSON.stringify(order), env }
}

/**
 * Assemble the MICROSANDBOX jailed spawn (no spawn performed) — the microVM tier
 * of the pi worker jail, testable without a VM. The case tree compiles to mounts,
 * the order speaks guest coordinates (projectRoot = mount path), and the brokered
 * credential is delivered into the guest env via `credential.passthrough.env`
 * (see the CREDENTIAL POSTURE note on the module). Fails CLOSED the same way the
 * seatbelt prep does: no credential to broker, or a sandbox policy that will not
 * compile (unmappable root, image refused by admission — sandbox/gate.ts).
 */
export async function preparePiSandboxedSpawn(
  input: PiRecipeRuntimeInput,
  target: PiJailedTarget,
  config: PiJailedConfig,
): Promise<PiSandboxedSpawnPlan> {
  const sandbox = config.sandbox
  if (sandbox === undefined) {
    return { ok: false, reason: 'preparePiSandboxedSpawn called with no runtime.sandbox — fail closed' }
  }
  const hostEnv = config.env ?? process.env

  // Broker the model credential host-side. No credential = no auth to hand the
  // guest = fail closed (parity with the seatbelt prep).
  const blob = await readBrokeredCredential(target.provider, config.authPath)
  if (blob === undefined) {
    return { ok: false, reason: `provider '${target.provider}' has no stored credential to broker into the sandbox (run: pi /login)` }
  }

  const mountPath = sandbox.mount_path ?? DEFAULT_MOUNT_PATH
  const scratchDir = join(input.projectRoot, '.waypoint', 'scratch', input.routeId, input.taskId)
  // A retry starts from a clean scratch so stale artifacts cannot be admitted as
  // this attempt's (mirrors the seatbelt prep and worker-runtime).
  if (input.priorAttempt !== undefined) await rm(scratchDir, { recursive: true, force: true })
  await mkdir(scratchDir, { recursive: true })

  // The order speaks the GUEST's coordinates: the worker runs with the case tree
  // at mountPath, so projectRoot is the mount path (the child writes its claim to
  // {mountPath}/.waypoint/claims/..., which the mount maps back to the host).
  const order: PiWorkOrder = {
    routeId: input.routeId,
    taskId: input.taskId,
    recipe: input.recipe,
    prompt: input.prompt,
    projectRoot: mountPath,
    ...(input.modelClass ? { modelClass: input.modelClass } : {}),
    provider: target.provider,
    model: target.model,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.access ? { access: input.access } : {}),
    ...(config.roots ? { roots: config.roots } : {}),
    ...(config.piPolicy ? { piPolicy: config.piPolicy } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
  }

  // Deliver the brokered blob into the guest env. This is the sanctioned
  // subscription/OAuth mechanism (passthrough.env, by reference — `--env NAME`,
  // never `--env NAME=value`); the wall is the egress allowlist, which admission
  // already forced to default:deny + a provider host.
  const piSandbox: WaypointProjectSandboxConfig = {
    ...sandbox,
    credential: {
      ...sandbox.credential,
      passthrough: {
        ...sandbox.credential?.passthrough,
        env: [...(sandbox.credential?.passthrough?.env ?? []), BROKER_ENV],
      },
    },
  }

  // The env we VALIDATE `--env`/`--secret` against MUST be the env we spawn msb
  // with (rsc-wxk): msb resolves references from its own process environment.
  const spawnEnv: NodeJS.ProcessEnv = { ...hostEnv, [BROKER_ENV]: blob }

  try {
    const prep = await prepareSandboxedRun({
      sandbox: piSandbox,
      argv: ['node', config.guestEntry ?? PI_GUEST_ENTRY],
      workOrder: JSON.stringify(order),
      projectRoot: input.projectRoot,
      roots: config.roots,
      access: input.access,
      scratchDir,
      claimDir: join(input.projectRoot, '.waypoint', 'claims', input.routeId),
      env: spawnEnv,
      ...(config.msbCommand ? { msbCommand: config.msbCommand } : {}),
    })
    return { ok: true, argv: prep.argv, spawnEnv, order }
  } catch (error) {
    return { ok: false, reason: `sandbox refused the pi attempt (no spawn): ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Run the jailed pi worker. Routes to the microsandbox tier when the project
 * configures runtime.sandbox (and it is not env-disabled), else the seatbelt
 * tier. Both prepare the spawn (fail closed on refusal), spawn through the shared
 * `runWorkerCommand` (process-group kill + budget), then derive the outcome from
 * process-exit × the file claim — the child already judged and wrote the claim;
 * the host does not trust say-so.
 */
export async function runPiJailed(
  input: PiRecipeRuntimeInput,
  target: PiJailedTarget,
  config: PiJailedConfig,
): Promise<PiRecipeRuntimeOutput> {
  const hostEnv = config.env ?? process.env
  const budgetMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (config.sandbox !== undefined && sandboxEnabledForProject(config.sandbox, hostEnv)) {
    const plan = await preparePiSandboxedSpawn(input, target, config)
    if (!plan.ok) return buildOutput(input, target, 'failed', null, plan.reason)
    let result: WorkerCommandResult
    try {
      // stdin is empty: msb does not deliver a pipe to the guest, so the order is
      // staged into the mount and redirected in (sandbox/runtime.ts).
      result = await runWorkerCommand(plan.argv, '', input.projectRoot, budgetMs, input.signal, plan.spawnEnv)
    } catch (error) {
      const enoent = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
      const why = enoent
        ? `the sandbox command '${plan.argv[0]}' was not found — install microsandbox or set WAYPOINT_MSB_COMMAND`
        : error instanceof Error
          ? error.message
          : String(error)
      return buildOutput(input, target, 'failed', null, `sandbox refused the pi attempt (no spawn): ${why}`)
    }
    return deriveJailedOutcome(input, target, result, budgetMs)
  }

  const plan = await preparePiJailedSpawn(input, target, config)
  if (!plan.ok) return buildOutput(input, target, 'failed', null, plan.reason)
  const result = await runWorkerCommand(plan.argv, plan.stdin, input.projectRoot, budgetMs, input.signal, plan.env)
  return deriveJailedOutcome(input, target, result, budgetMs)
}

/**
 * Outcome derivation shared by both tiers: process-exit × the file claim. The
 * claim is read host-side after exit (from the seatbelt claim dir or through the
 * sandbox mount — same host path either way).
 */
async function deriveJailedOutcome(
  input: PiRecipeRuntimeInput,
  target: PiJailedTarget,
  result: WorkerCommandResult,
  budgetMs: number,
): Promise<PiRecipeRuntimeOutput> {
  if (result.aborted) return buildOutput(input, target, 'stopped', null, 'run aborted; the jailed process group was killed')
  if (result.timedOut) {
    return buildOutput(input, target, 'exhausted', null, `jailed pi worker exceeded the ${Math.round(budgetMs / 1000)}s budget`)
  }

  const claim = await readSandboxClaim(input.projectRoot, input.routeId, input.taskId)
  if (result.exitCode !== 0) {
    return buildOutput(input, target, 'failed', claim, `jailed pi worker exited ${result.exitCode ?? `on signal ${result.signal ?? 'unknown'}`}`)
  }
  if (claim === null) {
    return buildOutput(input, target, 'failed', null, 'the jailed pi worker exited 0 but wrote no report claim')
  }
  const status = typeof claim.status === 'string' ? claim.status : null
  if (status !== 'finished') {
    const summary = typeof claim.summary === 'string' ? `: ${claim.summary}` : ''
    return buildOutput(input, target, 'failed', claim, `jailed pi worker reported '${status ?? 'unknown'}'${summary}`)
  }
  const summary = typeof claim.summary === 'string' && claim.summary !== '' ? claim.summary : 'finished'
  return buildOutput(input, target, 'finished', claim, summary)
}

function buildOutput(
  input: PiRecipeRuntimeInput,
  target: PiJailedTarget,
  status: PiRecipeRuntimeStatus,
  report: Record<string, unknown> | null,
  closeReason: string,
): PiRecipeRuntimeOutput {
  return {
    status,
    runtime: 'pi',
    recipe: input.recipe,
    task_id: input.taskId,
    route_id: input.routeId,
    report,
    close_reason: closeReason,
    provider: target.provider,
    model: target.model,
    // Path-level denials happen inside the jailed child and reach the host only
    // via the claim, not as host-side blocked_tools entries.
    blocked_tools: [],
  }
}
