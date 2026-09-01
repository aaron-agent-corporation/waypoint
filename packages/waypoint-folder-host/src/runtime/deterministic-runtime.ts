import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { prepareSeatbeltJail, seatbeltEnabledForProject } from '../seatbelt/jail.ts'
import type { WaypointProjectRootConfig } from '../project/config.ts'
import { runWorkerCommand } from './worker-spawn.ts'
import { verifyScratchArtifacts, type RecipeRuntimeOutputStatus } from './work-order.ts'

/**
 * The deterministic recipe runtime (B2, docs/designs/deterministic-recipes.md).
 *
 * A sibling of {@link WorkerRecipeRuntime} for `runtime.kind: deterministic`
 * recipes: mechanical, exact host steps (assembling documents into a package)
 * that must NOT be entrusted to a language model. Instead of spawning the
 * configured agent command with a work order, it spawns a VETTED entrypoint —
 * resolved from a fixed registry, never an arbitrary command from recipe
 * YAML — under the SAME Seatbelt write jail the worker uses (the plan's
 * `build: rw` grant), and derives the outcome from PROCESS EXIT × declared
 * artifact verification, with no report row (the tool's exit code is the
 * truth; a deterministic step has nothing to self-report):
 *
 *   aborted            → stopped
 *   budget elapsed     → exhausted
 *   exit ≠ 0           → failed (the tool refused; nothing partial applied)
 *   exit 0 + artifacts → finished
 *
 * The output shape matches the worker runtime's so `normalizeOutcome` and the
 * bridge are untouched.
 */

export interface DeterministicRecipeRuntimeConfig {
  /** Named roots from `.waypoint/config.yaml`; the Seatbelt jail's base capabilities. */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /** Env consulted for the WAYPOINT_SEATBELT gate (test seam; default process.env). */
  readonly env?: NodeJS.ProcessEnv
  /** Attempt budget; on expiry the process group is killed and the attempt reports `exhausted`. */
  readonly timeoutMs?: number
}

export interface DeterministicRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  /** Host-claimed plan ref for this dispatch; never inherited from process env. */
  readonly taskRef?: string
  readonly recipe: string
  /** The vetted host-step name (recipe.runtime.entrypoint). */
  readonly entrypoint?: string
  readonly projectRoot: string
  /** Declared `produces:` — verified non-empty after exit 0 (the direct-write anchor). */
  readonly outputArtifacts?: readonly string[]
  /** The plan's `access:` map — feeds the Seatbelt jail (fail-closed when enabled). */
  readonly access?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

export interface DeterministicRecipeRuntimeOutput {
  readonly status: RecipeRuntimeOutputStatus
  readonly runtime: 'deterministic'
  readonly recipe: string
  readonly entrypoint: string | null
  readonly task_id: string
  readonly route_id: string
  readonly exit_code: number | null
  readonly signal: NodeJS.Signals | null
  readonly close_reason: string
  readonly jailed: boolean
  readonly applied: readonly string[]
  readonly missing: readonly string[]
  readonly stdout: string
  readonly stderr: string
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
/** Keep the tail of a subprocess stream in a close reason (evidence, bounded). */
const STREAM_TAIL = 2000

type EntrypointRoots = Readonly<Record<string, WaypointProjectRootConfig>> | undefined

/**
 * The vetted deterministic entrypoints. A recipe names one; the runtime maps
 * it to an argv here (sync, or async when preparation is needed; a
 * preparation failure is a failed dispatch, never a silent fallback). An
 * unknown name fails closed — recipe YAML can never name an arbitrary
 * command to run on the host.
 *
 * The core distribution ships an EMPTY registry: deterministic entrypoints
 * are vetted host code, so hosts register their own here (or in a later core
 * module) and recipes name them in `recipe.runtime.entrypoint`.
 */
const ENTRYPOINTS: Record<
  string,
  (projectRoot: string, roots: EntrypointRoots) => readonly string[] | Promise<readonly string[]>
> = {}

/**
 * Register a vetted entrypoint — the host extension point this module exists
 * for. Re-registering a name replaces it (idempotent host startup); there is
 * no unregister because an entrypoint a running route can name must never
 * vanish mid-flight.
 */
export function registerDeterministicEntrypoint(
  name: string,
  factory: (projectRoot: string, roots: EntrypointRoots) => readonly string[] | Promise<readonly string[]>,
): void {
  ENTRYPOINTS[name] = factory
}

/**
 * Resolve a vetted entrypoint's argv without running it. Test seam for
 * entrypoints whose argv depends on project state.
 */
export async function resolveDeterministicEntrypointArgv(
  name: string,
  projectRoot: string,
  roots?: EntrypointRoots,
): Promise<readonly string[] | undefined> {
  const factory = ENTRYPOINTS[name]
  if (factory === undefined) return undefined
  return factory(projectRoot, roots)
}

export class DeterministicRecipeRuntime {
  private readonly config: DeterministicRecipeRuntimeConfig

  constructor(config: DeterministicRecipeRuntimeConfig = {}) {
    this.config = config
  }

  async runRecipe(input: DeterministicRecipeRuntimeInput): Promise<DeterministicRecipeRuntimeOutput> {
    const budgetMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const base = {
      runtime: 'deterministic' as const,
      recipe: input.recipe,
      entrypoint: input.entrypoint ?? null,
      task_id: input.taskId,
      route_id: input.routeId,
    }

    const build = input.entrypoint ? ENTRYPOINTS[input.entrypoint] : undefined
    if (!build) {
      return {
        ...base,
        status: 'failed',
        exit_code: null,
        signal: null,
        close_reason: `unknown deterministic entrypoint ${input.entrypoint ? `'${input.entrypoint}'` : '(none)'} — not in the vetted registry`,
        jailed: false,
        applied: [],
        missing: [],
        stdout: '',
        stderr: '',
      }
    }

    // Preparation (e.g. a host toolchain bootstrap) that fails is a
    // failed attempt with NO SPAWN — the environment is the host's to provision,
    // and a provisioning failure must surface, never silently degrade.
    let argv: readonly string[]
    try {
      argv = await build(input.projectRoot, this.config.roots)
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        exit_code: null,
        signal: null,
        close_reason: `entrypoint preparation failed (no spawn): ${error instanceof Error ? error.message : String(error)}`,
        jailed: false,
        applied: [],
        missing: [],
        stdout: '',
        stderr: '',
      }
    }

    // Seatbelt (W2): fail-CLOSED, exactly as the worker runtime — an
    // unjailable attempt (no access map, unknown binding, escalation) is a
    // failed attempt with NO SPAWN, never an unjailed one.
    let jailed = false
    let workerTmpDir: string | null = null
    if (seatbeltEnabledForProject(this.config.roots, this.config.env ?? process.env)) {
      try {
        // rsc-g0p: the entrypoint's own temp, inside the case folder. The jail no
        // longer grants the shared system temp, so a vetted entrypoint that opens
        // a temp file (pdf assembly does) needs one it is actually allowed to
        // write — and TMPDIR below is what points it there.
        const tmpDir = join(input.projectRoot, '.waypoint', 'tmp', input.routeId, input.taskId)
        await mkdir(tmpDir, { recursive: true })
        const jail = await prepareSeatbeltJail({
          projectRoot: input.projectRoot,
          roots: this.config.roots,
          access: input.access,
          scratchDir: `${input.projectRoot}/.waypoint/scratch/${input.routeId}/${input.taskId}`,
          tmpDir,
          name: `${input.routeId}-${input.taskId}`,
        })
        argv = jail.wrapArgv(argv)
        jailed = true
        workerTmpDir = tmpDir
      } catch (error) {
        return {
          ...base,
          status: 'failed',
          exit_code: null,
          signal: null,
          close_reason: `seatbelt jail refused the attempt (no spawn): ${error instanceof Error ? error.message : String(error)}`,
          jailed: false,
          applied: [],
          missing: [],
          stdout: '',
          stderr: '',
        }
      }
    }

    // No work order: a deterministic entrypoint takes no prompt on stdin.
    // rsc-g0p: under the jail, TMPDIR must name the granted temp — the host's
    // points at the shared system temp the profile no longer allows.
    const env = {
      ...(this.config.env ?? process.env),
      WAYPOINT_ROUTE_ID: input.routeId,
      WAYPOINT_TASK_ID: input.taskId,
      ...(input.taskRef === undefined ? {} : { WAYPOINT_TASK_REF: input.taskRef }),
      ...(workerTmpDir === null ? {} : { TMPDIR: workerTmpDir }),
    }
    const result = await runWorkerCommand(argv, '', input.projectRoot, budgetMs, input.signal, env)
    const common = {
      ...base,
      exit_code: result.exitCode,
      signal: result.signal,
      jailed,
      stdout: result.stdout,
      stderr: result.stderr,
      applied: [] as readonly string[],
      missing: [] as readonly string[],
    }

    if (result.aborted) {
      return { ...common, status: 'stopped', close_reason: 'stopped: externally aborted; the process group was killed' }
    }
    if (result.timedOut) {
      return {
        ...common,
        status: 'exhausted',
        close_reason: `exhausted: process group killed after the ${budgetMs}ms budget — retry with a bigger budget`,
      }
    }
    if (result.exitCode !== 0) {
      return {
        ...common,
        status: 'failed',
        close_reason: `deterministic step exited ${result.exitCode ?? `on signal ${result.signal ?? 'unknown'}`}${
          result.stderr.trim() !== '' ? `: ${result.stderr.trim().slice(-STREAM_TAIL)}` : ''
        }`,
      }
    }

    // exit 0: the direct writes land in the case tree (build: rw). Verify the
    // declared artifacts exist and are non-empty — the deterministic analogue
    // of verify-then-apply admission.
    const artifacts = input.outputArtifacts ?? []
    const missing = await verifyScratchArtifacts(input.projectRoot, artifacts)
    if (missing.length > 0) {
      return {
        ...common,
        status: 'failed',
        close_reason: `deterministic step exited 0 but ${missing.length} declared artifact(s) failed verification (${missing.join('; ')})`,
        missing,
      }
    }
    return {
      ...common,
      status: 'finished',
      close_reason: `deterministic step ${input.entrypoint} finished; ${artifacts.length} declared artifact(s) verified`,
      applied: artifacts,
    }
  }
}
