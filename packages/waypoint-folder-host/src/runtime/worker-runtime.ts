import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { retiredWorkerHarnessProblem } from './cordis-only.ts'
import { prepareSeatbeltJail, seatbeltEnabledForProject } from '../seatbelt/jail.ts'
import { claimHostPath, claimSandboxPath, readSandboxClaim, toSandboxPath } from '../sandbox/claim.ts'
import { sandboxEnabledForProject } from '../sandbox/gate.ts'
import type { ProjectSandboxProvider } from '../sandbox/provider.ts'
import { DEFAULT_MOUNT_PATH, prepareSandboxedRun, SANDBOX_COMMAND_ENV, type SandboxPreparation } from '../sandbox/runtime.ts'
import { artifactContractFor } from './artifact-contracts.ts'
import { evaluateReviewChecks, gateBriefProblem, type ReviewSpec } from './review-admission.ts'
import { buildWorkerEnv } from './worker-env.ts'
import { runWorkerCommand, type WorkerCommandResult } from './worker-spawn.ts'
import type { WaypointProjectRootConfig, WaypointProjectSandboxConfig } from '../project/config.ts'
import {
  applyScratchArtifacts,
  buildWorkOrder,
  verifyScratchArtifacts,
  type RecipeModelClass,
  type RecipeRuntimeApply,
  type RecipeRuntimeOutputStatus,
  type RecipeRuntimePriorAttempt,
} from './work-order.ts'

/**
 * The worker runtime (P3/W3, docs/designs/p3-worker-host.md): the host
 * spawns the configured agent command directly as a subprocess — work order
 * on stdin, model class resolved to CLI args, the Seatbelt write jail
 * wrapped around the argv when enabled — and derives the attempt's outcome
 * from PROCESS EXIT × the CLAIM the agent wrote, never from agent say-so
 * (2026-05-06 rule):
 *
 *   exit 0 + finished report + artifacts verify  → finished (applied)
 *   report failed, exit ≠ 0, or no report at all → failed
 *   abort                                        → stopped
 *   budget elapsed                               → exhausted
 *
 * The agent reports by writing its CLAIM FILE (.waypoint/claims/<route>/<task>.json,
 * sandbox/claim.ts) — the one report seam on every path (rsc-452); this runtime
 * reads it and is the judge. The host records that claim on the dispatch after
 * exit (pgdurable/bridge.ts) — the worker has no route to Postgres of its own.
 * Verify-then-apply admission and the retry prior-attempt section live in
 * work-order.ts.
 */

export interface WorkerRecipeRuntimeConfig {
  /** The agent binary, e.g. `claude`. */
  readonly command: string
  /** Base args, e.g. `['-p']`. The work order arrives on stdin. */
  readonly args?: readonly string[]
  /**
   * Model-class routing: the recipe's declared class maps to extra CLI
   * args (e.g. high -> ['--model','opus']). An unmapped or absent class
   * adds nothing (the command's default model).
   */
  readonly modelArgs?: Partial<Readonly<Record<RecipeModelClass, readonly string[]>>>
  /** Attempt budget; on expiry the process group is killed and the attempt
   * reports `exhausted` (retry with a bigger budget, not a step failure). */
  readonly timeoutMs?: number
  /** Verify-then-apply admission (rsc-nrm). */
  readonly verifyThenApply?: boolean
  /** Named roots from `.waypoint/config.yaml`; the Seatbelt jail's base capabilities. */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /**
   * microsandbox worker sandbox (rsc-wxk). When configured and not disabled by
   * env, the attempt runs inside a microVM INSTEAD of a bare host subprocess,
   * and the seatbelt does not apply (SBPL is macOS; the VM interior is Linux).
   */
  readonly sandbox?: WaypointProjectSandboxConfig
  /** Test seam: inject a ProjectSandboxProvider for the managed cloud enter
   *  path (fly-sprites) instead of the admission-bound factory. */
  readonly sandboxProvider?: ProjectSandboxProvider
  /** The `msb` binary (test seam); defaults to $WAYPOINT_MSB_COMMAND, then `msb`. */
  readonly msbCommand?: string
  /**
   * EXTRA env names the worker inherits beyond the built-in allowlist
   * (rsc-m8x). From `runtime.worker.env_allow`.
   */
  readonly envAllow?: readonly string[]
  /** Env consulted for the WAYPOINT_SEATBELT / WAYPOINT_SANDBOX gates (test seam; default process.env). */
  readonly env?: NodeJS.ProcessEnv
  /**
   * Environment this worker is spawned with ON TOP of the allowlisted set —
   * a lane's own credential home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, …), so
   * two lanes can run the same binary against two different subscriptions.
   * Values, not names: the lane declares them, the operator can read them.
   */
  readonly envInject?: Readonly<Record<string, string>>
  /** Operator-facing lane name, for logs. Absent outside a pool. */
  readonly laneName?: string
  /** The account this lane runs on — so a failure names the subscription. */
  readonly laneEmail?: string
  /**
   * How the work order reaches the agent. `stdin` (default) pipes it, which
   * claude, codex and gemini all read. Some CLIs take the prompt only as an
   * argument and refuse an empty one — kimi answers "Prompt cannot be empty"
   * to a piped order — so `arg` appends it as the final argv entry instead.
   */
  readonly workOrderVia?: 'stdin' | 'arg'
  /**
   * Reads the attempt's report row after the process exits (test seam).
   * Default reads the agent's claim file (.waypoint/claims/<route>/<task>.json);
   * the worker wrote it there because it has no route to Postgres (rsc-452).
   */
  readonly readReport?: (projectRoot: string, taskId: string) => Promise<Record<string, unknown> | null>
}

export interface WorkerRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  /** Host-claimed plan ref for this dispatch; never inherited from worker env. */
  readonly taskRef?: string
  readonly recipe: string
  readonly prompt: string
  readonly projectRoot: string
  readonly modelClass?: RecipeModelClass
  readonly outputArtifacts?: readonly string[]
  /**
   * Vetted content-level contract (rsc-6al, artifact-contracts.ts) the
   * declared artifacts must satisfy before apply: existence checks prove an
   * artifact is there, the contract proves its consumer can use it. Unknown
   * names fail closed.
   */
  readonly artifactContract?: string
  /**
   * Declared review checks (rsc-8vw, review-admission.ts). A review-bearing
   * plan is admitted only when its report itemizes a passing verdict for every
   * named check — the plan is its own independent reviewer in the quest graph.
   */
  readonly review?: ReviewSpec
  /**
   * This task's completion opens a human gate with no plain-language account
   * of the work yet: a finished report must carry a `brief` or admission
   * rejects it (Aaron 2026-08-14). Computed by the bridge from the task graph.
   */
  readonly gateFacing?: boolean
  /** The plan's `access:` map — feeds the Seatbelt jail (fail-closed when enabled). */
  readonly access?: Readonly<Record<string, string>>
  /**
   * Which slice of its tool surface this step gets (`runtime.tool_group` on the
   * recipe). A closed surface serves a whole quest by handing each step only
   * its own capabilities — the refuter cannot rewrite the pages it judges, the
   * extractor cannot post to the billing ledger. Absent means the surface
   * decides, which for a shell-and-files worker is everything, as before.
   */
  readonly toolGroup?: string
  /**
   * The one fan-out item this dispatch owns (rsc-m23.7). Set by the bridge from
   * the plan's `runner.fanout_item`, which the start-time expansion wrote. It
   * reaches the worker twice on purpose: named in the work order so the agent
   * knows its boundary, and in the environment so a tool surface can scope
   * itself to the item rather than trusting the agent to stay inside it.
   */
  readonly fanoutItem?: { readonly slug: string; readonly label: string; readonly path?: string }
  readonly priorAttempt?: RecipeRuntimePriorAttempt
  readonly signal?: AbortSignal
  /** Stable post-Gate request. It deliberately has no path or credential field. */
}

export interface WorkerRecipeRuntimeUsage {
  readonly started_at: string
  readonly ended_at: string
  readonly duration_ms: number
  readonly budget_ms: number
}

export interface WorkerRecipeRuntimeOutput {
  readonly status: RecipeRuntimeOutputStatus
  readonly runtime: 'worker'
  readonly recipe: string
  readonly task_id: string
  readonly route_id: string
  readonly exit_code: number | null
  readonly signal: NodeJS.Signals | null
  /** The agent's report row (its claim), verbatim; null when it never reported. */
  readonly report: Record<string, unknown> | null
  /** The HOST's verdict on the attempt — how the status was derived. */
  readonly close_reason: string | null
  /** Was a write jail enforced? True for an SBPL-jailed host spawn AND for a
   *  sandboxed run (where the mount set is the jail). */
  readonly jailed: boolean
  /** Did this attempt run inside a microsandbox microVM (egress + brokering)? */
  readonly sandboxed: boolean
  readonly usage: WorkerRecipeRuntimeUsage
  /**
   * WHO did this work: the lane, the account it billed to, and the model that
   * ran. Every attempt carries it, so an outcome can be traced to a
   * subscription without reading a config file — and so the record of which
   * model does which task well is a by-product of running, not a study
   * someone has to remember to start (Aaron 2026-07-28).
   */
  readonly worker: WorkerRecipeRuntimeAttribution
  readonly apply: RecipeRuntimeApply
  readonly stdout: string
  readonly stderr: string
}

export interface WorkerRecipeRuntimeAttribution {
  /** Lane name; null when the project runs a single unnamed worker. */
  readonly lane: string | null
  /** The account's email, when the lane names one. */
  readonly account: string | null
  /** The capability class the recipe asked for. */
  readonly model_class: RecipeModelClass | null
  /** The model actually selected, read off the args the lane passed. */
  readonly model: string | null
  /** The binary that ran — the provider, in the only form we can prove. */
  readonly command: string
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

export class WorkerRecipeRuntime {
  private readonly config: WorkerRecipeRuntimeConfig

  constructor(config: WorkerRecipeRuntimeConfig) {
    if (config.command.trim() === '') throw new Error('Worker runtime requires an agent command')
    // Item 53 (cordis-only) backstop: programmatic configs get the same
    // retired-harness refusal the YAML parse applies.
    const retired = retiredWorkerHarnessProblem(config.command)
    if (retired) throw new Error(retired)
    this.config = config
  }

  async runRecipe(input: WorkerRecipeRuntimeInput): Promise<WorkerRecipeRuntimeOutput> {
    const startedAtMs = Date.now()
    const budgetMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const effectiveRoots = this.config.roots
    const effectiveAccess = input.access
    const effectiveSandbox = this.config.sandbox

    // Verify-then-apply scratch: fixed placement so the rest of the stack
    // (admission, evidence) reads identically across runtimes.
    const scratch =
      this.config.verifyThenApply && (input.outputArtifacts?.length ?? 0) > 0
        ? join(input.projectRoot, '.waypoint', 'scratch', input.routeId, input.taskId)
        : null
    if (scratch !== null) {
      // A retry starts from a clean write root so the failed attempt's stale
      // artifacts cannot be admitted as this attempt's evidence.
      if (input.priorAttempt !== undefined) await rm(scratch, { recursive: true, force: true })
      await mkdir(scratch, { recursive: true })
    }


    const scratchDir = scratch ?? join(input.projectRoot, '.waypoint', 'scratch', input.routeId, input.taskId)
    // rsc-g0p: the attempt's private temp, inside the case folder and granted by
    // the jail. Replaces a blanket rw grant on the SHARED system temp — on macOS
    // os.tmpdir() is every app's temp space, so the "confined" worker could
    // scribble into any other application's.
    const tmpDir = join(input.projectRoot, '.waypoint', 'tmp', input.routeId, input.taskId)
    // A lane that takes the order as an ARGUMENT ends its base args with the
    // flag that carries it (`kimi … -p`, `grok … -p`), so the order must be
    // the very next word. Model args slotted between the two turned
    // `kimi -p <order>` into `kimi -p --model kimi-code/k3 <order>`: the flag
    // became the prompt and the model name became a command
    // ("unknown command 'kimi-code/k3'"). Every kimi and grok dispatch that
    // declared a model class died there. On a stdin lane the order is not in
    // argv at all, so nothing moves.
    const laneArgs = this.config.args ?? []
    const modelArgs = this.modelArgsFor(input.modelClass)
    const viaArg = this.config.workOrderVia === 'arg'
    const argv0 = viaArg
      ? [this.config.command, ...modelArgs, ...laneArgs]
      : [this.config.command, ...laneArgs, ...modelArgs]

    // Sandboxed runs take a different path entirely (rsc-3yf, Phase 2). The
    // seatbelt CANNOT come along: SBPL is macOS and the sandbox interior is
    // Linux, so wrapping the argv in sandbox-exec here would send a macOS binary
    // into a Linux container and fail every attempt. The access map still rules
    // — the sandbox compiles the same roots into read-only volume mounts.
    if (effectiveSandbox !== undefined && sandboxEnabledForProject(effectiveSandbox, this.config.env ?? process.env)) {
      return this.runSandboxed(input, {
        startedAtMs,
        budgetMs,
        argv: argv0,
        scratch,
        scratchDir,
        sandbox: effectiveSandbox,
        roots: effectiveRoots,
        access: effectiveAccess,
      })
    }

    // rsc-452: the report seam is the file claim on this path too, not
    // `waypoint tasks report`. The agent writes its claim JSON to claimFile; the
    // host reads it after exit. No route to the run database (no
    // WAYPOINT_POSTGRES_URL) enters the worker. The dir is pre-created (the agent
    // must be able to open the file) and, when jailed, granted rw.
    const claimDir = join(input.projectRoot, '.waypoint', 'claims', input.routeId)
    const claimFile = claimHostPath(input.projectRoot, input.routeId, input.taskId)
    // A retry must not inherit the prior attempt's claim as its own verdict.
    if (input.priorAttempt !== undefined) await rm(claimFile, { force: true })
    await mkdir(claimDir, { recursive: true })

    // Seatbelt (W2): fail-CLOSED — with the jail enabled, an unjailable
    // attempt (no access map, unknown binding, escalation, uncompilable
    // profile) is a failed attempt with NO SPAWN, never an unjailed spawn.
    let argv = argv0
    let jailed = false
    let workerTmpDir: string | null = null
    if (seatbeltEnabledForProject(this.config.roots, this.config.env ?? process.env)) {
      try {
        // The temp dir must EXIST before TMPDIR names it: scratchDir is only
        // created when verify-then-apply is on, and a TMPDIR pointing at nothing
        // breaks every tool that opens a temp file. A retry starts clean for the
        // same reason the scratch does — stale temp from a failed attempt is not
        // this attempt's.
        if (input.priorAttempt !== undefined) await rm(tmpDir, { recursive: true, force: true })
        await mkdir(tmpDir, { recursive: true })
        const jail = await prepareSeatbeltJail({
          projectRoot: input.projectRoot,
          roots: effectiveRoots,
          access: effectiveAccess,
          scratchDir,
          tmpDir,
          claimDir,
          agentHomes: laneCredentialHomes(this.config.envInject),
          name: `${input.routeId}-${input.taskId}`,
        })
        argv = jail.wrapArgv(argv)
        jailed = true
        workerTmpDir = tmpDir
      } catch (error) {
        return this.output(input, 'failed', {
          startedAtMs,
          budgetMs,
          closeReason: `seatbelt jail refused the attempt (no spawn): ${error instanceof Error ? error.message : String(error)}`,
          jailed: false,
        })
      }
    }

    const workOrder = buildWorkOrder(
      {
        ...input,
      },
      scratch,
      {
        claimPath: claimFile,
        // A tool group is what closes the surface, so it is also what decides the
        // report medium: this worker has a `report` tool and no way to write a file.
        ...(input.toolGroup !== undefined ? { reportsViaTool: true } : {}),
      },
    )

    // rsc-m8x: an ALLOWLISTED env, not the Console's whole environment. The
    // seatbelt is a write jail and leaves network open, so an agent reading
    // untrusted case documents used to sit on every secret the supervisor had
    // exported, with somewhere to send them.
    const env = {
      ...buildWorkerEnv(
        this.config.env ?? process.env,
        this.config.envAllow ?? [],
        this.config.command,
      ),
      ...(this.config.envInject ?? {}),
    }
    // rsc-g0p: point the worker's temp INTO the jail. The host's TMPDIR is
    // allowlisted (tools need one), but under the jail it names a directory the
    // profile no longer grants — so it must be replaced, not merely inherited,
    // or every temp write dies. Only when jailed: an unjailed worker is not
    // confined anyway, and silently relocating its temp would be a surprise with
    // no security benefit.
    // CLAUDE_CODE_TMPDIR is the second half, and an in-vivo run is the only
    // reason we know it: claude honors TMPDIR for most things, but its Bash
    // tool hardcodes a working directory under `/tmp/claude-<uid>/<slug>`,
    // which TMPDIR does not move. Without this the jail is not merely
    // inconvenient — the worker loses ALL shell execution, including the
    // `waypoint tasks report` call the report contract requires, so every
    // attempt dead-ends with no report. Setting a var a non-claude agent
    // ignores costs nothing; the alternative is granting the shared temp back.
    //
    // KNOWN RESIDUAL, verified in vivo: BSD `mktemp` with no arguments does NOT
    // honor TMPDIR on macOS — it reads the Darwin confstr temp dir, i.e. exactly
    // the shared temp we just closed — so it fails EPERM under the jail. Node
    // and Python both honor TMPDIR and are unaffected. This is accepted, not
    // fixed: the failure is LOUD (a refused syscall the worker sees and can work
    // around by templating under $TMPDIR), and the only "fix" would be granting
    // the shared temp back, which is the hole this whole change closes.
    if (workerTmpDir !== null) {
      env.TMPDIR = workerTmpDir
      env.CLAUDE_CODE_TMPDIR = workerTmpDir
    }
    // Where this attempt's claim goes, for workers that have no file-writing
    // tool. A closed tool surface (the bundled worker server) removes `write`
    // on purpose — and the first tools-only run proved that also removes the
    // report seam: the agent read its inputs, reasoned "I need to write a file
    // at a specific path … but I don't have a file-writing tool", and exited 0
    // with no claim, so a working attempt was recorded as failed. The tool
    // surface supplies a `report` tool; this is how it learns the path,
    // instead of every surface hard-coding the .waypoint/claims layout.
    env.WAYPOINT_CLAIM_PATH = claimFile
    env.WAYPOINT_ROUTE_ID = input.routeId
    env.WAYPOINT_TASK_ID = input.taskId
    if (input.taskRef !== undefined) env.WAYPOINT_TASK_REF = input.taskRef
    if (input.toolGroup !== undefined) env.WAYPOINT_TOOL_GROUP = input.toolGroup
    if (input.fanoutItem !== undefined) env.WAYPOINT_FANOUT_ITEM = input.fanoutItem.slug

    const result = await runWorkerCommand(
      viaArg ? [...argv, workOrder] : argv,
      viaArg ? '' : workOrder,
      input.projectRoot,
      budgetMs,
      input.signal,
      env,
    )
    return this.deriveOutcome(input, result, {
      startedAtMs,
      budgetMs,
      jailed,
      scratch,
      // rsc-452: read the agent's claim from the file, exactly as the sandbox
      // path does — the report never round-trips through Postgres. The
      // config.readReport test seam still wins when injected.
      readReport: () =>
        this.config.readReport
          ? this.config.readReport(input.projectRoot, input.taskId)
          : readSandboxClaim(input.projectRoot, input.routeId, input.taskId),
    })
  }

  /**
   * The verdict — process exit × report row × verify-then-apply — shared by the
   * host and sandbox paths. Both runtimes produce the same `RunResult` shape, so
   * the judgement lives here once: a second copy would be a second place for the
   * 2026-05-06 rule ("never agent say-so") to quietly drift.
   */
  private async deriveOutcome(
    input: WorkerRecipeRuntimeInput,
    result: WorkerCommandResult,
    ctx: {
      startedAtMs: number
      budgetMs: number
      jailed: boolean
      scratch: string | null
      /** Sandboxed runs read the agent's claim from a file, not a dispatch row. */
      readReport?: () => Promise<Record<string, unknown> | null>
      sandboxed?: boolean
    },
  ): Promise<WorkerRecipeRuntimeOutput> {
    const { startedAtMs, budgetMs, jailed, scratch } = ctx
    const common = {
      startedAtMs,
      budgetMs,
      jailed,
      sandboxed: ctx.sandboxed ?? false,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    }
    if (result.aborted) {
      return this.output(input, 'stopped', { ...common, closeReason: 'stopped: externally aborted; the process group was killed' })
    }
    if (result.timedOut) {
      return this.output(input, 'exhausted', {
        ...common,
        closeReason: `exhausted: process group killed after the ${budgetMs}ms budget; work-so-far retained${scratch !== null ? ` in ${scratch}` : ''} — retry with a bigger budget`,
      })
    }

    // The verdict: process exit × report row. The report is read AFTER exit
    // so a still-writing agent cannot race its own judgement.
    const report = ctx.readReport ? await ctx.readReport() : await this.readReport(input.projectRoot, input.taskId)
    const reportStatus = report !== null && typeof report.status === 'string' ? report.status : null
    const reportSummary = report !== null && typeof report.summary === 'string' ? report.summary : ''

    if (result.exitCode !== 0) {
      return this.output(input, 'failed', {
        ...common,
        report,
        closeReason: `process exited ${result.exitCode ?? `on signal ${result.signal ?? 'unknown'}`}${reportStatus !== null ? ` (agent reported '${reportStatus}' — exit status wins)` : ''}`,
      })
    }
    if (report === null) {
      return this.output(input, 'failed', {
        ...common,
        report,
        // Name the seam this worker actually had. A tools-only worker cannot
        // write a claim file, so telling an operator reading the dossier that it
        // failed to do so sends them looking for the wrong thing — the same
        // mistake the work order itself used to make.
        closeReason:
          input.toolGroup !== undefined
            ? 'process exited 0 but the attempt has no report — the worker never called its `report` tool (this one commonly means it ran out of turns mid-work; retry it)'
            : 'process exited 0 but the attempt has no report — the report contract (write the claim file) is mandatory',
      })
    }
    if (reportStatus !== 'finished') {
      return this.output(input, 'failed', {
        ...common,
        report,
        closeReason: `agent reported '${reportStatus ?? 'unknown'}'${reportSummary !== '' ? `: ${reportSummary}` : ''}`,
      })
    }

    // exit 0 + finished report: admit through verify-then-apply.
    if (scratch !== null) {
      const artifacts = input.outputArtifacts ?? []
      const missing = await verifyScratchArtifacts(scratch, artifacts)
      if (missing.length > 0) {
        return this.output(input, 'failed', {
          ...common,
          report,
          closeReason: `verify-then-apply rejected: ${missing.length} declared artifact(s) failed verification against the scratch (${missing.join('; ')}); nothing was applied to the case tree — scratch retained at ${scratch}`,
          apply: { mode: 'verify_then_apply', scratch_dir: scratch, applied: [], missing },
        })
      }
      // Content-level contract (rsc-6al): the artifacts exist — now prove
      // the consumer would accept them, BEFORE anything reaches the case tree.
      const contractProblems = await this.runArtifactContract(input, scratch)
      if (contractProblems.length > 0) {
        return this.output(input, 'failed', {
          ...common,
          report,
          closeReason: `verify-then-apply rejected: artifact contract '${input.artifactContract}' failed (${summarizeContractProblems(contractProblems)}); nothing was applied to the case tree — scratch retained at ${scratch}`,
          apply: { mode: 'verify_then_apply', scratch_dir: scratch, applied: [], missing: [...contractProblems] },
        })
      }
      // Review admission (rsc-8vw): a review-bearing plan is its own independent
      // reviewer; its report must itemize a passing verdict for every declared
      // check. A failing or missing verdict rejects the attempt BEFORE anything
      // reaches the case tree — the same verify-then-apply discipline artifacts get.
      const reviewProblems = input.review ? evaluateReviewChecks(input.review, report) : []
      if (reviewProblems.length > 0) {
        return this.output(input, 'failed', {
          ...common,
          report,
          closeReason: `review admission rejected: ${reviewProblems.length} declared check(s) unmet (${reviewProblems.join('; ')}); nothing was applied to the case tree — scratch retained at ${scratch}`,
          apply: { mode: 'verify_then_apply', scratch_dir: scratch, applied: [], missing: [...reviewProblems] },
        })
      }
      // Gate-brief admission (Aaron 2026-08-14): work that opens a human gate
      // must arrive with the plain-language note the gate leads with.
      const briefProblem = input.gateFacing === true ? gateBriefProblem(report) : null
      if (briefProblem !== null) {
        return this.output(input, 'failed', {
          ...common,
          report,
          closeReason: `review admission rejected: ${briefProblem}; nothing was applied to the case tree — scratch retained at ${scratch}`,
          apply: { mode: 'verify_then_apply', scratch_dir: scratch, applied: [], missing: [briefProblem] },
        })
      }
      const applied = await applyScratchArtifacts(scratch, input.projectRoot, artifacts)
      return this.output(input, 'finished', {
        ...common,
        report,
        closeReason: reportSummary !== '' ? reportSummary : 'finished (verified)',
        apply: { mode: 'verify_then_apply', scratch_dir: scratch, applied, missing: [] },
      })
    }
    // Scratchless run: the agent wrote in place, but a declared contract
    // still judges the result — silently skipping it would be a mute verifier.
    const contractProblems = await this.runArtifactContract(input, input.projectRoot)
    if (contractProblems.length > 0) {
      return this.output(input, 'failed', {
        ...common,
        report,
        closeReason: `artifact contract '${input.artifactContract}' failed (${summarizeContractProblems(contractProblems)}) — the artifacts were written in place (no scratch); downstream consumption would refuse`,
      })
    }
    // Review admission (rsc-8vw) — a declared review is enforced even on the
    // scratchless path; silently skipping it would be the mute verifier the
    // whole feature exists to close.
    const reviewProblems = input.review ? evaluateReviewChecks(input.review, report) : []
    if (reviewProblems.length > 0) {
      return this.output(input, 'failed', {
        ...common,
        report,
        closeReason: `review admission rejected: ${reviewProblems.length} declared check(s) unmet (${reviewProblems.join('; ')})`,
      })
    }
    // Gate-brief admission — enforced on the scratchless path too; a mute
    // gate is the same failure whichever way the files got written.
    const briefProblem = input.gateFacing === true ? gateBriefProblem(report) : null
    if (briefProblem !== null) {
      return this.output(input, 'failed', {
        ...common,
        report,
        closeReason: `review admission rejected: ${briefProblem}`,
      })
    }
    return this.output(input, 'finished', {
      ...common,
      report,
      closeReason: reportSummary !== '' ? reportSummary : 'finished',
    })
  }

  /**
   * The sandboxed attempt (rsc-3yf, Phase 2). Everything after the run is
   * identical to the host path — the case tree is bind-mounted, so the scratch,
   * artifact verification and apply all still operate on the same bytes,
   * host-side. Only two things change: the process lives in the sandbox (access
   * map compiled to mounts, not SBPL), and the agent's claim arrives as a file
   * because Postgres is unreachable from inside.
   *
   * Fail-CLOSED: any setup failure is a failed attempt with NO SPAWN. There is
   * no un-sandboxed fallback — falling back would run the agent with the real
   * key on the open internet exactly when the sandbox mattered most.
   */
  private async runSandboxed(
    input: WorkerRecipeRuntimeInput,
    ctx: {
      startedAtMs: number
      budgetMs: number
      argv: readonly string[]
      scratch: string | null
      scratchDir: string
      sandbox: WaypointProjectSandboxConfig
      roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
      access: Readonly<Record<string, string>> | undefined
    },
  ): Promise<WorkerRecipeRuntimeOutput> {
    const sandbox = ctx.sandbox
    const mountPath = sandbox.mount_path ?? DEFAULT_MOUNT_PATH
    // The scratch dir is a mount source; it must exist before the sandbox binds it.
    await mkdir(ctx.scratchDir, { recursive: true })

    // The work order must speak the SANDBOX's coordinates. Handing the agent
    // host paths (/Users/…/case) would name directories that do not exist
    // inside the container — every instruction in the frame would be a lie.
    let workOrder: string
    try {
      workOrder = buildWorkOrder(
        {
          ...input,
          projectRoot: mountPath,
        },
        ctx.scratch === null ? null : toSandboxPath(input.projectRoot, ctx.scratch, mountPath),
        { claimPath: claimSandboxPath(mountPath, input.routeId, input.taskId) },
      )
    } catch (error) {
      return this.output(input, 'failed', {
        startedAtMs: ctx.startedAtMs,
        budgetMs: ctx.budgetMs,
        closeReason: `sandbox refused the attempt (no spawn): ${error instanceof Error ? error.message : String(error)}`,
        jailed: false,
        sandboxed: true,
      })
    }

    // Compile the policy to argv BEFORE spawning: an unjailable attempt must
    // cost nothing and start no VM.
    let prepared: SandboxPreparation
    try {
      prepared = await prepareSandboxedRun({
        sandbox,
        argv: ctx.argv,
        workOrder,
        projectRoot: input.projectRoot,
        roots: ctx.roots,
        access: ctx.access,
        scratchDir: ctx.scratchDir,
        claimDir: join(input.projectRoot, '.waypoint', 'claims', input.routeId),
        env: this.config.env ?? process.env,
        ...(this.config.msbCommand ? { msbCommand: this.config.msbCommand } : {}),
      })
    } catch (error) {
      return this.output(input, 'failed', {
        startedAtMs: ctx.startedAtMs,
        budgetMs: ctx.budgetMs,
        closeReason: `sandbox refused the attempt (no spawn): ${error instanceof Error ? error.message : String(error)}`,
        jailed: false,
        sandboxed: true,
      })
    }

    // The SAME spawn as the unsandboxed path: `msb` is an ordinary subprocess,
    // so the process-group kill, the SIGTERM→SIGKILL escalation and the budget
    // deadline are the ones already proven here — not a second implementation.
    // stdin is deliberately empty: msb does not deliver a pipe to the guest, so
    // the order is staged into the mount and redirected in.
    // The env we spawn msb with MUST be the env we validated `--secret` against:
    // msb resolves ENV@HOST from its own process environment, so a divergence
    // here means passing admission and then handing msb an unresolvable
    // reference (caught live, rsc-wxk).
    let result: WorkerCommandResult
    try {
      result = await runWorkerCommand(prepared.argv, '', input.projectRoot, ctx.budgetMs, input.signal, this.config.env ?? process.env)
    } catch (error) {
      // A missing `msb` is the one predictable spawn failure this backend adds,
      // and a raw ENOENT out of the bridge names neither the cause nor the fix.
      // It stays a refusal rather than a fallback: running the agent unsandboxed
      // because the sandbox binary is absent would be fail-OPEN.
      const enoent = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
      const why = enoent
        ? `the sandbox command '${prepared.argv[0]}' was not found on PATH — install microsandbox or set ${SANDBOX_COMMAND_ENV}`
        : error instanceof Error
          ? error.message
          : String(error)
      return this.output(input, 'failed', {
        startedAtMs: ctx.startedAtMs,
        budgetMs: ctx.budgetMs,
        closeReason: `sandbox refused the attempt (no spawn): ${why}`,
        jailed: false,
        sandboxed: true,
      })
    }

    return this.deriveOutcome(
      input,
      result,
      {
        startedAtMs: ctx.startedAtMs,
        budgetMs: ctx.budgetMs,
        // The mount jail IS the write jail here — the attempt is jailed, just
        // not by SBPL. Reporting jailed:false would understate the boundary.
        jailed: true,
        sandboxed: true,
        scratch: ctx.scratch,
        readReport: () => readSandboxClaim(input.projectRoot, input.routeId, input.taskId),
      },
    )
  }

  /** Empty result = no contract declared, or the contract is satisfied. */
  private async runArtifactContract(input: WorkerRecipeRuntimeInput, scratchDir: string): Promise<readonly string[]> {
    if (input.artifactContract === undefined) return []
    const contract = artifactContractFor(input.artifactContract)
    if (contract === null) {
      // Compile admission refuses unknown names; if one reaches the runtime
      // anyway (hand-edited metadata, registry drift), fail closed here too.
      return [`unknown artifact contract '${input.artifactContract}' — not in the vetted registry`]
    }
    return contract({ scratchDir, projectRoot: input.projectRoot })
  }

  /**
   * The model is read off the ARGS the lane actually passes rather than from a
   * separate declaration, because the args are what the provider obeys — a
   * second field would be free to drift from the model that really ran.
   */
  private attributionFor(modelClass: RecipeModelClass | undefined): WorkerRecipeRuntimeAttribution {
    const args = this.modelArgsFor(modelClass)
    const flag = args.findIndex((arg) => arg === '--model' || arg === '-m')
    return {
      lane: this.config.laneName ?? null,
      account: this.config.laneEmail ?? null,
      model_class: modelClass ?? null,
      model: flag >= 0 ? (args[flag + 1] ?? null) : null,
      command: this.config.command,
    }
  }

  private modelArgsFor(modelClass: RecipeModelClass | undefined): readonly string[] {
    if (modelClass === undefined) return []
    return this.config.modelArgs?.[modelClass] ?? []
  }

  private async readReport(projectRoot: string, taskId: string): Promise<Record<string, unknown> | null> {
    if (this.config.readReport !== undefined) return this.config.readReport(projectRoot, taskId)
    // Reports live on durable dispatch rows (W1); a plain-postgres run has
    // no report surface at all, so the attempt's outcome derives from
    // process exit alone — return null instead of failing the whole attempt
    // on a mode the seam cannot exist on.
    const { getWaypointProjectPaths } = await import('../project/root.ts')
    const { readWaypointProjectConfig } = await import('../project/config.ts')
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    if (config.backend.postgres?.durable !== true) return null
    // Dynamic import: bridge.ts reaches this module's package through the
    // autopilot runtime factory, so a static import would be a cycle.
    const { latestDurableTaskAttempt } = await import('../pgdurable/bridge.ts')
    const attempt = await latestDurableTaskAttempt(projectRoot, taskId)
    return attempt?.report ?? null
  }

  private output(
    input: WorkerRecipeRuntimeInput,
    status: RecipeRuntimeOutputStatus,
    details: {
      startedAtMs: number
      budgetMs: number
      closeReason: string
      jailed: boolean
      sandboxed?: boolean
      report?: Record<string, unknown> | null
      exitCode?: number | null
      signal?: NodeJS.Signals | null
      stdout?: string
      stderr?: string
      apply?: RecipeRuntimeApply
    },
  ): WorkerRecipeRuntimeOutput {
    const endedAtMs = Date.now()
    return {
      status,
      runtime: 'worker',
      recipe: input.recipe,
      task_id: input.taskId,
      route_id: input.routeId,
      exit_code: details.exitCode ?? null,
      signal: details.signal ?? null,
      report: details.report ?? null,
      close_reason: details.closeReason,
      jailed: details.jailed,
      sandboxed: details.sandboxed ?? false,
      usage: {
        started_at: new Date(details.startedAtMs).toISOString(),
        ended_at: new Date(endedAtMs).toISOString(),
        duration_ms: endedAtMs - details.startedAtMs,
        budget_ms: details.budgetMs,
      },
      worker: this.attributionFor(input.modelClass),
      apply: details.apply ?? { mode: 'direct', scratch_dir: null, applied: [], missing: [] },
      stdout: details.stdout ?? '',
      stderr: details.stderr ?? '',
    }
  }
}

/**
 * A contract can emit hundreds of problems (Alma's plan drew 573); the close
 * reason keeps enough to diagnose without swallowing the dispatch row.
 */
function summarizeContractProblems(problems: readonly string[]): string {
  const shown = problems.slice(0, 8)
  const rest = problems.length - shown.length
  return `${problems.length} problem(s): ${shown.join('; ')}${rest > 0 ? `; … ${rest} more` : ''}`
}

/**
 * Where a lane keeps the agent's own state, from the env the lane injects.
 *
 * A lane bound to a second subscription points its CLI at a home of its own,
 * and that CLI writes sessions and logs there. The jail grants the DEFAULT
 * homes as baseline viability; this grants the lane's.
 */
const CREDENTIAL_HOME_VARS = [
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'KIMI_CODE_HOME',
  'GROK_HOME',
  'PI_CODING_AGENT_DIR',
] as const

export function laneCredentialHomes(
  envInject: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  if (envInject === undefined) return []
  const homes = new Set<string>()
  for (const name of CREDENTIAL_HOME_VARS) {
    const value = envInject[name]
    if (typeof value === 'string' && value.trim() !== '') homes.add(value.trim())
  }
  return [...homes]
}
