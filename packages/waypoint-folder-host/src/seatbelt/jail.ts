import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { WaypointProjectRootConfig } from '../project/config.ts'
import { compileSeatbeltProfile, type SeatbeltRoot } from './profile.ts'
import { seatbeltWrapArgv, writeSeatbeltProfile } from './wrap.ts'

/**
 * A resolved privilege boundary: a named root, an absolute host path, and the
 * capability this attempt gets on it. Backend-neutral — the seatbelt compiles
 * these to SBPL, the microsandbox runtime compiles them to VM mounts. Same
 * shape as SeatbeltRoot; the alias names the concept without churning the
 * profile compiler's vocabulary.
 */
export type AccessRoot = SeatbeltRoot

/**
 * Execution surfaces INSIDE the workspace that no plan may ever make writable
 * (rsc-dqj). Paths are relative to the project root.
 *
 * Why these exist as a separate, always-on concept rather than as roots an
 * author declares: a jailed worker that writes `.git/hooks/pre-commit` has not
 * escaped the jail — it has planted a payload that the jail will never run.
 * The OPERATOR runs it, on the host, unjailed, with a full environment and
 * network, the next time anyone types `git commit` in that vault. The worker
 * plants; the human detonates. Our own evidence model requires real commits in
 * the case tree, so the trigger is guaranteed rather than hypothetical. Proven
 * live against a shipped access map before this fix existed.
 *
 * `.git/config` is the same class by a different route: `core.pager`,
 * `core.editor`, `core.sshCommand`, aliases, and `filter.*.clean|smudge` are
 * all commands git executes, and `include.path` can pull in more.
 * `.git/modules` carries a submodule's own config and hooks.
 *
 * HONEST LIMITATION — this is a denylist, and denylists are enumerations, the
 * failure mode this layer otherwise exists to avoid. The allowlist alternative
 * (deny `.git` wholesale, grant back what git writes) is worse in practice:
 * commits touch objects, index, index.lock, refs, logs, ORIG_HEAD, packed-refs
 * and more, so an incomplete allowlist breaks the evidence model itself. The
 * mitigating structure is that these are MANDATORY: they hold for every plan
 * without the author naming them, so the enumeration lives in one reviewed
 * place instead of across 43 quests.
 */
export const MANDATORY_RO_HOLES: readonly string[] = ['.git/hooks', '.git/config', '.git/modules']

/** Is `candidate` the same path as `ancestor`, or nested beneath it? */
function isAtOrUnder(candidate: string, ancestor: string): boolean {
  if (candidate === ancestor) return true
  const rel = path.relative(ancestor, candidate)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * The per-worker write jail on the spawn path (P3/W2): assemble the grant set
 * from the project's named roots (rsc-8ip, `.waypoint/config.yaml` `roots:`)
 * crossed with the plan's `access:` map, compile it fail-closed, and wrap the
 * worker argv in sandbox-exec.
 *
 * Env-gated like Crew's CREW_SEATBELT was — but where that v1 wrapper was
 * fail-OPEN (unwrapped fallback on any failure), this one is fail-CLOSED per
 * the P3 architecture call: when the jail is enabled, a plan with no access
 * map, an unknown binding, an escalation, or a profile that will not compile
 * or write means NO SPAWN, not an unjailed spawn.
 */

/** Turns the write jail on globally: "1", "true", "on" (case-insensitive). */
export const SEATBELT_ENV = 'WAYPOINT_SEATBELT'

export function seatbeltJailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[SEATBELT_ENV] ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

/**
 * Per-project jail gate (rsc-w0z): a project that declares named roots IS a
 * case project — its quests bind per-plan access maps, so the jail is on by
 * default. This is why enabling the jail can't be a single global env var: a
 * blanket WAYPOINT_SEATBELT=1 would fail closed on every coding quest (no roots,
 * no access maps). Roots exist only to arm this jail, so their presence is the
 * per-project signal. The env var remains a global override/test seam — set it
 * to force the jail on for a project that declares no roots (which then fails
 * closed unless its plans declare `access: {}`), exactly the old behavior.
 */
export function seatbeltEnabledForProject(
  roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (roots !== undefined && Object.keys(roots).length > 0) return true
  return seatbeltJailEnabled(env)
}

/**
 * What `resolveAccessRoots` needs, and nothing else — the shared base BOTH
 * backends answer to (the seatbelt's SBPL and the sandbox's mounts).
 *
 * Split out when the seatbelt gained `tmpDir` (rsc-g0p): the sandbox has no use
 * for one — a container brings its own /tmp — and inheriting the field would
 * have forced every mount call site to invent a value it ignores. The base
 * carries what the ACCESS MAP means; each backend adds what its own host needs.
 */
export interface AccessMapInput {
  /** The project root; named-root paths resolve relative to it. */
  readonly projectRoot: string
  /** Named roots from `.waypoint/config.yaml` (base capabilities). */
  readonly roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
  /**
   * The plan's `access:` map ({binding -> 'ro' | 'rw'}). REQUIRED when the
   * jail is enabled: undefined means the author never declared a boundary,
   * and the jail refuses to guess (fail closed). An explicitly empty map is
   * valid — the worker gets only its scratch dir plus the viability baseline.
   */
  readonly access: Readonly<Record<string, string>> | undefined
  /** The task's scratch write root (verify-then-apply staging) — always rw. */
  readonly scratchDir: string
}

export interface SeatbeltJailInput extends AccessMapInput {
  /**
   * The attempt's PRIVATE temp dir — always rw, and the worker's `TMPDIR`
   * (rsc-g0p). Seatbelt-only: it replaces the blanket grant on the host's SHARED
   * temp, and a sandbox has no equivalent hole to close. Kept out of scratchDir
   * so verify-then-apply staging holds artifacts and nothing else.
   */
  readonly tmpDir: string
  /**
   * The attempt's file-claim dir (`.waypoint/claims/<route>/`) — granted rw when
   * present (rsc-452). The worker reports by writing its claim JSON here instead
   * of `waypoint tasks report`, so no route to the run database (no
   * `WAYPOINT_POSTGRES_URL`) ever enters the worker. The sandbox path gets this for
   * free from the workspace mount; the seatbelt path needs the explicit grant.
   * Optional: a deterministic step has no report/claim, so it grants nothing.
   */
  readonly claimDir?: string
  /**
   * The lane's OWN credential home (`CLAUDE_CONFIG_DIR`, `KIMI_CODE_HOME`,
   * `CODEX_HOME`, …) — rw, for the same reason `~/.claude` is.
   *
   * An agent CLI keeps its session state under its home and dies without it:
   * the kimi lane's runs on the live case all failed with `EPERM: mkdir
   * ~/.waypoint/subs/kimi-…/sessions/…` (Aaron 2026-07-30). The default home is
   * baseline; a lane pointed at a second subscription needs its own.
   */
  readonly agentHomes?: readonly string[]
}

/**
 * Resolve the plan's `access:` map against the project's declared roots — the
 * ONE place that decides who may write where. Backend-neutral on purpose: the
 * host spawn compiles these into SBPL rules, and the microsandbox runtime
 * (rsc-3yf) compiles the same roots into nested read/read-only volume mounts.
 * Two resolvers would be two chances to disagree about a privilege boundary, so
 * there is only this one.
 *
 * Fail-closed rules:
 * - no access map on the plan → error (declare `access: {}` for "scratch only")
 * - a binding naming no declared root → error
 * - a plan asking rw on a base-ro root → error (escalation past the base capability)
 * - anything but 'ro'/'rw' → error
 *
 * Plan-'ro' bindings are included as ro roots ON PURPOSE: they carry no write
 * grant, but each backend needs them to punch a read-only HOLE into any broad rw
 * grant that encloses them (an ordered SBPL deny; a nested readOnly mount), so
 * the rw grant cannot silently re-open them.
 */
export function resolveAccessRoots(input: AccessMapInput): AccessRoot[] {
  if (input.access === undefined) {
    throw new Error(
      'seatbelt: the plan declares no access map — with the jail enabled that means no spawn (declare `access: {}` for scratch-only work)',
    )
  }
  const declared = input.roots ?? {}
  const roots: AccessRoot[] = []
  for (const [binding, rawMode] of Object.entries(input.access)) {
    // Optional modes 'ro?'/'rw?' (rsc-rvz two-tree seam): the binding is an
    // OPERATOR-granted external root (e.g. user_case from onboarding) that
    // only exists on onboarded projects — absent means skip the grant, never
    // fail. Required (unsuffixed) bindings keep the fail-closed contract:
    // a misspelled root still refuses the spawn.
    const optional = typeof rawMode === 'string' && rawMode.endsWith('?')
    const mode = optional ? rawMode.slice(0, -1) : rawMode
    const root = declared[binding]
    if (root === undefined) {
      if (optional) continue
      throw new Error(`seatbelt: access map names root ${JSON.stringify(binding)} but the project config declares no such root (fail closed)`)
    }
    if (mode !== 'ro' && mode !== 'rw') {
      throw new Error(`seatbelt: access for root ${JSON.stringify(binding)} is ${JSON.stringify(rawMode)} (want ro|rw, optionally suffixed '?')`)
    }
    if (mode === 'rw' && root.access === 'ro') {
      throw new Error(
        `seatbelt: plan asks rw on root ${JSON.stringify(binding)} whose base capability is ro — escalation refused (fail closed)`,
      )
    }
    roots.push({ name: binding, path: path.resolve(input.projectRoot, root.path), access: mode })
  }

  // The mandatory holes (rsc-dqj). Appended for EVERY plan, whether or not its
  // access map mentions them — protection that depended on 43 quest authors
  // each remembering to name a `git_hooks` root would be protection in name
  // only. A plan cannot grant them either: rw at or under a hole is refused as
  // escalation, exactly like rw on a base-ro root.
  const holes = MANDATORY_RO_HOLES.map((rel) => path.resolve(input.projectRoot, rel))
  for (const root of roots) {
    if (root.access !== 'rw') continue
    const hole = holes.find((h) => isAtOrUnder(root.path, h))
    if (hole !== undefined) {
      throw new Error(
        `seatbelt: root ${JSON.stringify(root.name)} asks rw on ${root.path}, which is at or under the mandatory read-only hole ` +
          `${hole} — that path is an execution surface the operator triggers OUTSIDE the jail (rsc-dqj); escalation refused (fail closed)`,
      )
    }
  }
  for (const [index, hole] of holes.entries()) {
    roots.push({ name: `mandatory-hole:${MANDATORY_RO_HOLES[index]}`, path: hole, access: 'ro', mandatory: true })
  }
  return roots
}

/**
 * The seatbelt's root set: the resolved access roots plus the baseline
 * viability roots (mirrors Crew's jailRoots) — the scratch dir is the only
 * work-owned writable root; temp dirs, /dev, and the agent's own state under
 * $HOME are what a live worker on THIS MACHINE needs to function at all.
 *
 * These baseline roots are seatbelt-only: they describe the host, and a
 * container brings its own /tmp, /dev and home.
 */
export function assembleSeatbeltJailRoots(input: SeatbeltJailInput): SeatbeltRoot[] {
  const roots = resolveAccessRoots(input)

  roots.push({ name: 'scratch', path: input.scratchDir, access: 'rw' })

  /**
   * The attempt's OWN temp dir — not the shared system temp (rsc-g0p).
   *
   * This used to grant rw on `os.tmpdir()` and `/tmp` as "baseline viability".
   * On macOS os.tmpdir() is /private/var/folders/... — EVERY application's temp
   * space. So a jailed worker, which the operator is told is confined to the
   * case folder, could scribble into any other app's temp: a write-boundary hole
   * in the layer whose whole job is the write boundary. Found by diffing against
   * agent-space's seatbelt, which refuses exactly this and redirects TMPDIR into
   * the jail instead.
   *
   * The worker keeps a temp dir — tools legitimately need scratch space — but it
   * is HIS, inside the case folder, and `TMPDIR` points at it (worker-runtime.ts).
   * Contained instead of dead.
   */
  roots.push({ name: 'tmp', path: input.tmpDir, access: 'rw' })
  // The file-claim dir (rsc-452): the worker's ONLY report channel. Narrow and
  // per-route (`.waypoint/claims/<route>/`); the host reads only the current
  // task's claim from it, so a sibling-claim write there is never consumed.
  // Absent for a deterministic step (no report), so it grants nothing.
  if (input.claimDir !== undefined) roots.push({ name: 'claim', path: input.claimDir, access: 'rw' })
  roots.push({ name: 'dev', path: '/dev', access: 'rw' })
  const home = os.homedir()
  if (home !== '') {
    // `.pi` is here for the same reason `.claude` is: pi keeps GLOBAL settings
    // under it and takes a lockfile on startup, whatever PI_CODING_AGENT_DIR
    // points a lane at. Without it every pi lane dies in ~400ms with EPERM on
    // `settings.json.lock`, before it ever reads the work order.
    for (const rel of ['.claude', '.claude.json', '.pi', '.cache', 'Library/Caches', 'Library/Logs']) {
      roots.push({ name: `agent-state:${rel}`, path: path.join(home, rel), access: 'rw' })
    }
  }
  // A lane bound to its own subscription keeps its session state somewhere
  // else entirely; without this the CLI dies before it reads the work order.
  for (const agentHome of new Set(input.agentHomes ?? [])) {
    if (agentHome.trim() === '') continue
    roots.push({ name: `agent-home:${path.basename(agentHome)}`, path: agentHome, access: 'rw' })
  }
  return roots
}

export interface PreparedSeatbeltJail {
  readonly profilePath: string
  /** Rewrites a worker argv to run inside the jail. */
  readonly wrapArgv: (argv: readonly string[]) => string[]
}

/**
 * Compile the jail for one task attempt and install its profile under
 * `<projectRoot>/.waypoint/seatbelt/<name>.sb` — a directory the worker gets no
 * write grant on, so a jailed process cannot rewrite its own profile. Throws
 * on any failure; with the jail enabled the caller must treat that as
 * "do not spawn".
 */
export async function prepareSeatbeltJail(input: SeatbeltJailInput & { readonly name: string }): Promise<PreparedSeatbeltJail> {
  // Confine reads to the roots this recipe declared, over the project's own
  // tree. Without this the jail was write-only and a dispatched agent could
  // read every document in the case — and every other case on the machine —
  // regardless of what its recipe granted. An extractor instructed to read the
  // faithful shadows could simply re-read the source PDFs instead, which is
  // what the previous generation of this pipeline actually did.
  // Confine reads to this task's declared roots. The ENCLOSING directory is a
  // data root too, not just the project: cases are siblings, so denying only
  // the project root left an agent in one case free to read every document in
  // every other case on the machine — the exact cross-client exposure the jail
  // is supposed to prevent, and it survived the first version of this fix.
  const parent = path.dirname(input.projectRoot)
  const enclosing = parent === input.projectRoot || parent === path.sep ? [] : [parent]
  const profile = await compileSeatbeltProfile(assembleSeatbeltJailRoots(input), {
    dataRoots: [input.projectRoot, ...enclosing],
    cwdRoot: input.projectRoot,
  })
  const dir = path.join(input.projectRoot, '.waypoint', 'seatbelt')
  await mkdir(dir, { recursive: true })
  const profilePath = await writeSeatbeltProfile(dir, sanitizeProfileName(input.name), profile)
  return { profilePath, wrapArgv: (argv) => seatbeltWrapArgv(profilePath, argv) }
}

function sanitizeProfileName(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}
