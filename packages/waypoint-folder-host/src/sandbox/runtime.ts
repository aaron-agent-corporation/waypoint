import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import {
  allowRetiredMicrosandbox,
  isProductionSandboxBackend,
  RETIRED_MICROSANDBOX_MESSAGE,
  WAYPOINT_ALLOW_RETIRED_MICROSANDBOX,
} from '../project/config.ts'
import { toSandboxPath } from './claim.ts'
import { assembleSandboxMounts, toMountArgs, type SandboxMount } from './mounts.ts'

/**
 * Legacy local microsandbox argv builder (rsc-wxk — historical docs/spikes/microsandbox.md).
 *
 * **Production sandboxes are cloud providers** (`fly-sprites`, `exe-dev`) via
 * `ProjectSandboxProvider.enter` — not this module. `microsandbox` is retired;
 * `prepareSandboxedRun` / `buildSandboxArgv` refuse it unless
 * `WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1` (legacy unit tests of the argv shape).
 *
 * Same contract as `runWorkerCommand`: hand it an argv and a work order, get back
 * exit code, stdout/stderr, aborted/timedOut. What changes is where the process
 * lives — inside a microVM with a default-deny egress allowlist, brokered
 * credentials the guest never holds, and the access map compiled to mounts
 * instead of an SBPL profile.
 *
 * **This module builds argv; it does not spawn.** The retired microsandbox CLI
 * has no daemon — `msb` is an ordinary subprocess — so the caller
 * (`worker-runtime.ts`) reuses the SAME `runWorkerCommand` spawn machinery the
 * unsandboxed path uses. That is why `buildSandboxArgv` is pure and testable
 * without a VM (when the retired path is explicitly re-enabled).
 *
 * FAIL-CLOSED throughout: every failure here (mount refused, missing credential,
 * unmappable path, retired backend) THROWS, and the caller must treat that as
 * "no spawn". There is deliberately no un-sandboxed fallback.
 */

export const DEFAULT_MOUNT_PATH = '/work'

/** Overrides the bundled `msb` (bring-up, or pinning a different build). */
export const SANDBOX_COMMAND_ENV = 'WAYPOINT_MSB_COMMAND'

/**
 * Resolve the retired `msb` binary. The `microsandbox` npm package has been
 * removed from production dependencies — resolution fails closed with a clear
 * retired/missing error unless the operator overrides via `WAYPOINT_MSB_COMMAND`
 * or an explicit test seam. Legacy tests set `WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1`
 * and may skip when no binary is available.
 *
 * Historical note: when the package was declared, resolution walked
 * `node_modules` for the package `bin` shim (0.6.6 pin). That walk remains for
 * unusual layouts that still have the package installed locally.
 */
let bundledMsbPath: string | null | undefined
function bundledMsb(): string | null {
  if (bundledMsbPath !== undefined) return bundledMsbPath
  bundledMsbPath = null
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url))
    for (;;) {
      const manifestPath = path.join(dir, 'node_modules', 'microsandbox', 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
        const rel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.msb
        if (rel !== undefined) bundledMsbPath = path.join(path.dirname(manifestPath), rel)
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // Left null: clear retired/missing error below.
  }
  return bundledMsbPath
}

const MSB_MISSING_MESSAGE =
  `microsandbox is retired and the 'microsandbox' package is not installed — ` +
  `use 'fly-sprites' (or set ${WAYPOINT_ALLOW_RETIRED_MICROSANDBOX}=1 with ${SANDBOX_COMMAND_ENV} for legacy tests)`

/**
 * Which `msb` to run. Explicit argument (test seam) beats the operator's env
 * override, which beats a locally present package bin, which fails closed.
 */
export function resolveMsbCommand(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  if (explicit !== undefined && explicit !== '') return explicit
  const override = env[SANDBOX_COMMAND_ENV]
  if (override !== undefined && override !== '') return override
  const bundled = bundledMsb()
  if (bundled !== null) return bundled
  throw new Error(MSB_MISSING_MESSAGE)
}

function assertLegacyMicrosandboxAllowed(
  sandbox: WaypointProjectSandboxConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Cloud backends must use ProjectSandboxProvider.enter — never this argv path.
  if (isProductionSandboxBackend(sandbox.backend)) {
    throw new Error("use ProjectSandboxProvider.enter for cloud backends")
  }
  // Opt-in may live on process.env (test harness) or the host env seam passed in.
  const allowed =
    allowRetiredMicrosandbox(undefined, env) ||
    (env !== process.env && allowRetiredMicrosandbox(undefined, process.env))
  if (sandbox.backend === 'microsandbox' && !allowed) {
    throw new Error(RETIRED_MICROSANDBOX_MESSAGE)
  }
}

/**
 * What happens when a brokered secret is aimed at a host it is not bound to.
 *
 * Hardcoded, NOT configurable. `msb` also accepts `passthrough`, which sends the
 * secret anyway — an option whose only effect is to defeat brokering, and which
 * no project config should be able to select. `block-and-terminate` over
 * `block-and-log` because a worker steering a credential at an unbound host is
 * either broken or hijacked; either way the attempt has no honest outcome left
 * and should die loudly rather than continue and report success.
 */
const SECRET_VIOLATION_ACTION = 'block-and-terminate'

/** Where the work order is staged (host side; the mount makes it visible). */
export function orderHostPath(scratchDir: string): string {
  return path.join(scratchDir, 'work-order.md')
}

export interface SandboxArgvInput {
  readonly sandbox: WaypointProjectSandboxConfig
  /** The agent argv, e.g. ['claude', '-p', '--dangerously-skip-permissions']. */
  readonly argv: readonly string[]
  readonly mounts: readonly SandboxMount[]
  readonly mountPath: string
  /** Guest path of the staged work order, redirected onto the agent's stdin. */
  readonly orderSandboxPath: string
  /** Host env the credentials are read from (test seam; default process.env). */
  readonly env?: NodeJS.ProcessEnv
  /** Host paths of credential files, pre-resolved (see resolveCredentialFiles). */
  readonly credentialFiles?: readonly ResolvedCredentialFile[]
  readonly msbCommand?: string
}

export interface ResolvedCredentialFile {
  readonly hostPath: string
  readonly mountPath: string
  readonly readOnly: boolean
  readonly isDirectory: boolean
}

/**
 * Compile the whole policy into one `msb run` argv. Pure — every fail-closed
 * refusal below is reachable in a unit test with no VM and no network.
 */
export function buildSandboxArgv(input: SandboxArgvInput): string[] {
  const hostEnv = input.env ?? process.env
  assertLegacyMicrosandboxAllowed(input.sandbox, hostEnv)
  const args: string[] = [resolveMsbCommand(input.msbCommand, hostEnv), 'run', '--no-tty']

  // Egress. `default: allow` is refused at admission (sandbox/gate.ts), so by
  // the time we build argv the policy is deny + an explicit domain allowlist.
  // We still emit the flag explicitly rather than relying on a default:
  // microsandbox's own default is ALLOW, and an omitted flag would silently be
  // the opposite of the boundary the config asked for.
  args.push('--net-default', input.sandbox.egress.default === 'allow' ? 'allow' : 'deny')
  for (const host of input.sandbox.egress.allow ?? []) {
    args.push('--net-rule', `allow@${host}`)
  }

  // Brokered credentials: the value is read from the host env BY REFERENCE
  // (`ENV@HOST`) and never appears in argv. msb rejects the inline
  // `ENV=VALUE@HOST` form for the same reason our parser refuses NAME=value.
  for (const entry of input.sandbox.credential?.broker ?? []) {
    requireHostValue(hostEnv, entry.env_var, `runtime.sandbox.credential.broker[env_var=${entry.env_var}]`)
    for (const host of entry.hosts) {
      args.push('--secret', `${entry.env_var}@${host}`)
    }
  }
  if ((input.sandbox.credential?.broker ?? []).length > 0) {
    args.push('--on-secret-violation', SECRET_VIOLATION_ACTION)
  }

  // Passthrough env: named-only, passed BY REFERENCE as bare `--env NAME`, which
  // msb resolves from our environment. NOT `--env NAME=value` — that would put
  // the secret in msb's own command line, readable by any `ps` on the host. That
  // is the shape of CVE-2026-61670, and we are not going to reintroduce it in
  // our own argv.
  for (const name of input.sandbox.credential?.passthrough?.env ?? []) {
    requireHostValue(hostEnv, name, `runtime.sandbox.credential.passthrough.env`)
    args.push('--env', name)
  }

  args.push(...toMountArgs(input.mounts))

  // Credential files (OAuth token stores). Mounted last: they are absolute host
  // paths OUTSIDE the case tree, and must not be shadowed by a case mount.
  for (const file of input.credentialFiles ?? []) {
    args.push(file.isDirectory ? '--mount-dir' : '--mount-file', `${file.hostPath}:${file.mountPath}${file.readOnly ? ':ro' : ''}`)
  }

  args.push('--workdir', input.mountPath)
  args.push(input.sandbox.image)
  args.push('--')
  // The stdin gap: `msb run` does not deliver a piped stdin to the guest (probed
  // 2026-07-16 — a `cat` in the guest hangs rather than reading and closing). So
  // the order is staged into the mount and redirected in, exactly as the
  // OpenSandbox backend did. Do not "simplify" this into a stdin pipe without
  // re-probing it.
  args.push('/bin/sh', '-lc', `${input.argv.map(shq).join(' ')} < ${shq(input.orderSandboxPath)}`)
  return args
}

function requireHostValue(env: NodeJS.ProcessEnv, name: string, where: string): void {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `sandbox: ${where} names '${name}' but it is not set in the host environment — ` +
        'the worker would start unauthenticated and fail at its first model call (fail closed, no spawn)',
    )
  }
}

/**
 * Resolve the configured credential files against the host, so `buildSandboxArgv`
 * can stay pure. Absence fails closed: a missing token store means the agent
 * starts unauthenticated, and an auth error is the least legible way to discover
 * a config typo.
 */
export async function resolveCredentialFiles(sandbox: WaypointProjectSandboxConfig): Promise<ResolvedCredentialFile[]> {
  const resolved: ResolvedCredentialFile[] = []
  const files = sandbox.credential?.passthrough?.files ?? []
  for (const [index, file] of files.entries()) {
    const hostPath = expandHome(file.host_path)
    if (!path.isAbsolute(hostPath)) {
      throw new Error(`sandbox: credential.passthrough.files[${index}].host_path '${file.host_path}' is not absolute (fail closed, no spawn)`)
    }
    if (!(await exists(hostPath))) {
      throw new Error(
        `sandbox: credential.passthrough.files[${index}].host_path '${hostPath}' does not exist — ` +
          'the agent would start without the credential it needs (fail closed, no spawn)',
      )
    }
    resolved.push({
      hostPath,
      mountPath: file.mount_path,
      readOnly: file.access !== 'rw',
      isDirectory: (await stat(hostPath)).isDirectory(),
    })
  }
  return resolved
}

export interface SandboxPreparation {
  readonly argv: string[]
  readonly mounts: readonly SandboxMount[]
  readonly mountPath: string
}

export interface SandboxPrepareInput {
  readonly sandbox: WaypointProjectSandboxConfig
  readonly argv: readonly string[]
  readonly workOrder: string
  readonly projectRoot: string
  readonly scratchDir: string
  /** The attempt's claim dir (`.waypoint/claims/<route>`), mounted rw so the worker
   *  can file its claim regardless of the access map (rsc-clm). Created here. */
  readonly claimDir: string
  readonly roots: Readonly<Record<string, { readonly path: string; readonly access: 'ro' | 'rw' }>> | undefined
  readonly access: Readonly<Record<string, string>> | undefined
  readonly env?: NodeJS.ProcessEnv
  readonly msbCommand?: string
}

/**
 * Everything that must happen before the spawn: compile the access map to
 * mounts, stage the work order, and build the argv. Ordered so that an
 * unjailable attempt costs nothing — the mounts are compiled (and refused)
 * before anything is written and before any VM exists.
 */
export async function prepareSandboxedRun(input: SandboxPrepareInput): Promise<SandboxPreparation> {
  // Cloud providers: ProjectSandboxProvider.enter — not this legacy argv path.
  // microsandbox: retired unless WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1.
  assertLegacyMicrosandboxAllowed(input.sandbox, input.env ?? process.env)
  const mountPath = input.sandbox.mount_path ?? DEFAULT_MOUNT_PATH

  const mounts = await assembleSandboxMounts({
    projectRoot: input.projectRoot,
    roots: input.roots,
    access: input.access,
    scratchDir: input.scratchDir,
    claimDir: input.claimDir,
    mountPath,
  })

  const credentialFiles = await resolveCredentialFiles(input.sandbox)

  // Both mount sources must EXIST before the sandbox binds them — but only now
  // that the mounts compiled (an unjailable attempt above wrote nothing). The
  // claim dir is granted rw explicitly (rsc-clm), the same as the seatbelt jail;
  // the order is staged inside the scratch dir the mount set already grants rw.
  await mkdir(input.claimDir, { recursive: true })
  const hostOrder = orderHostPath(input.scratchDir)
  await mkdir(path.dirname(hostOrder), { recursive: true })
  await writeFile(hostOrder, input.workOrder, 'utf8')
  const orderSandboxPath = toSandboxPath(input.projectRoot, hostOrder, mountPath)

  const argv = buildSandboxArgv({
    sandbox: input.sandbox,
    argv: input.argv,
    mounts,
    mountPath,
    orderSandboxPath,
    ...(input.env ? { env: input.env } : {}),
    credentialFiles,
    ...(input.msbCommand ? { msbCommand: input.msbCommand } : {}),
  })

  return { argv, mounts, mountPath }
}

/** POSIX single-quote quoting for the command string we hand the guest shell. */
function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Credential paths are operator-written and conventionally use `~`. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
