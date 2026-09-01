/**
 * The Waypoint harness worker runtime — `runtime.kind: cordis`.
 *
 * A sibling of {@link WorkerRecipeRuntime} (spawns `claude -p`),
 * {@link PiRecipeRuntime} (the in-process pi loop) and
 * {@link DeterministicRecipeRuntime} (a vetted host step). The dispatch row,
 * signal loop and report-claim seam are identical to all three; what differs is
 * how the worker is BUILT.
 *
 * The difference in one sentence: a cordis recipe names every layer of its
 * agent — prompt, skills, references, tools, model class — and the composer
 * refuses at compose time if any named thing does not resolve. Nothing about
 * the worker's shape is implicit, and nothing it was granted is invisible.
 *
 * ── OUTCOME DISCIPLINE ──────────────────────────────────────────────────────
 * Terminal conditions win over the claim, always (the 2026-05-06 fabrication
 * incident is why): an abort is `stopped`, a budget elapse is `exhausted`, and
 * a run that ends without a report is `failed` no matter how confident the
 * model's closing paragraph was. The claim on disk is a CLAIM; the host decides.
 *
 * See docs/designs/waypoint-harness.md and the spike at `spike/cordis-brain`
 * (branch `cordis-brain-spike`), where every fence here was measured first.
 */
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import type { RecipeManifest } from '@waypoint/core'

import { agentLoopPlugin } from '@waypoint/kernel'

import { resolveBundledCatalogRoot } from '../catalog/bundled.ts'
import { claimHostPath, readSandboxClaim } from '../sandbox/claim.ts'
import { sandboxEnabledForProject } from '../sandbox/gate.ts'
import type { ProjectSandboxProvider } from '../sandbox/provider.ts'
import type { WaypointProjectRootConfig, WaypointProjectSandboxConfig } from '../project/config.ts'
import { runCordisJailed, type CordisLanePicker, type CordisWorkerLane } from './cordis-jailed-runtime.ts'
import { composeCordisWorker, cordisScratchDir, cordisTmpDir, CordisCompositionError } from './cordis/compose.ts'
import { cordisLlmPiAi, type PiAiResolver } from './cordis/llm-pi-ai.ts'
import { resolveModelTarget, type ModelTargets, type ProviderRegistry } from './model-routing.ts'
import { workerLaneProviderProblem } from './cordis-only.ts'
import type { RecipeModelClass, RecipeRuntimePriorAttempt } from './work-order.ts'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_MAX_TURNS = 24

export interface CordisRecipeRuntimeConfig {
  readonly registry: ProviderRegistry
  readonly modelTargets?: ModelTargets
  /** Declared roots — the jail's base capability set. */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /**
   * Extra skills roots, searched BEFORE the project's own and the installed
   * bundle. Test seam and operator escape hatch; normally unset.
   */
  readonly skillsRoots?: readonly string[]
  /** Absolute path to the MCP server entry. Absent = the bundled worker server (report-only). */
  readonly toolServer?: string
  readonly timeoutMs?: number
  readonly maxTurns?: number
  /** Spawn env base (carries the seatbelt gate). Test seam; default process.env. */
  readonly env?: NodeJS.ProcessEnv
  /** Inject a model resolver instead of building the real one (test seam). */
  readonly resolverFactory?: () => Promise<PiAiResolver>
  /** Production sandbox (S1) — when set, the run happens inside a fly-sprites
   *  VM via `runCordisJailed`; local composition only happens in the guest. */
  readonly sandbox?: WaypointProjectSandboxConfig
  /** The per-project sandbox provisioning record (`.waypoint/sandbox/binding.json`),
   *  admitted field-by-field before any enter — never inferred from cwd. */
  readonly managedBinding?: unknown
  /** Test seam: inject a ProjectSandboxProvider for managed enter. */
  readonly sandboxProvider?: ProjectSandboxProvider
  /** Set by the jailed child: already inside a sprite — do not re-enter, and
   *  spawn the MCP tool child without the (macOS-only) seatbelt wrap. */
  readonly alreadyJailed?: boolean
  /** The picked worker lane — the ONLY credential source on the cloud path (L4). */
  readonly lane?: CordisWorkerLane
  /**
   * Dispatch-time lane picker (L5) — supersedes `lane` when present. Invoked
   * inside the jailed path AFTER model resolution; the bridge builds it from
   * subscription homes + pg lane locks + the brain-reserve holdout.
   */
  readonly lanePicker?: CordisLanePicker
  /** Test seam: guest bundle path inside the sprite. */
  readonly guestEntry?: string
  /** Test seam: guest MCP server path inside the sprite. */
  readonly guestToolServer?: string
}

export interface CordisRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: RecipeManifest
  readonly prompt: string
  readonly projectRoot: string
  readonly modelClass?: RecipeModelClass
  /** The plan node's `access:` map ({binding -> 'ro' | 'rw'}). */
  readonly access?: Readonly<Record<string, string>>
  readonly outputArtifacts?: readonly string[]
  readonly fanoutItem?: { readonly slug: string; readonly label: string; readonly path?: string }
  readonly priorAttempt?: RecipeRuntimePriorAttempt
  readonly signal?: AbortSignal
}

export type CordisRecipeRuntimeStatus = 'finished' | 'failed' | 'exhausted' | 'stopped'

export interface CordisRecipeRuntimeOutput {
  readonly status: CordisRecipeRuntimeStatus
  readonly runtime: 'cordis'
  readonly recipe: string
  readonly task_id: string
  readonly route_id: string
  readonly report: Record<string, unknown> | null
  readonly close_reason: string | null
  readonly provider: string | null
  readonly model: string | null
  /**
   * The composition fingerprint. On the record for every attempt so a reviewer
   * can tell whether two runs were the same worker, and see the moment a
   * recipe, a skill file or the tool surface changed underneath them.
   */
  readonly composition_digest: string | null
  readonly blocked_tools: readonly string[]
  /**
   * S2 (item 52): the ADMITTED sandbox binding the attempt entered — provider,
   * instance id, image digest, policy/mount hashes — so the dispatch row can
   * carry where the work physically ran. `null` when the attempt ran outside a
   * VM (local composition) or was refused before admission produced a binding.
   */
  readonly sandbox?: Record<string, unknown> | null
}

/** The bundle's own skills dir — the last resort, for a source checkout whose
 *  case was never installed into. Resolved through the catalog loader so it is
 *  the same directory `waypoint init` copies from. */
async function bundledSkillsRoot(): Promise<string> {
  return join(await resolveBundledCatalogRoot(), 'skills')
}

/** The bundled MCP server, resolved through the package rather than by a
 *  relative path — the bridge runs from `dist`, so a path relative to this
 *  source file is right in exactly one of the two places it runs from. The
 *  bundled surface is report-only (the claim seam); a host's domain tools
 *  arrive through the `toolServer` config as their own MCP server. */
function bundledToolServer(): string {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@waypoint/worker-tools/package.json')
  return join(dirname(pkg), 'dist', 'mcp-server.js')
}

export class CordisRecipeRuntime {
  private readonly config: CordisRecipeRuntimeConfig

  constructor(config: CordisRecipeRuntimeConfig) {
    this.config = config
  }

  async runRecipe(input: CordisRecipeRuntimeInput): Promise<CordisRecipeRuntimeOutput> {
    // 1. Route the class to a concrete (provider, model), subscription-first.
    // Untagged is treated as `high` (docs/MODEL-ROUTING.md) and must then
    // resolve — there is no implicit default provider to fall back on, and
    // inventing one would silently spend on a model nobody chose.
    const modelClass = input.modelClass ?? input.recipe.runtime?.model_class ?? 'high'
    const resolved = resolveModelTarget(modelClass, {
      modelTargets: this.config.modelTargets,
      registry: this.config.registry,
    })
    if (!resolved.ok) return this.fail(input, null, null, null, `model routing failed: ${resolved.reason}`)
    const { provider, model } = resolved.target

    // Item 53 (cordis-only): Anthropic never rides a worker lane. Refuse the
    // resolved target BEFORE any jail entry or composition — the brain keeps
    // Anthropic via its own explicitly named api_key path, which is not this one.
    const laneProblem = workerLaneProviderProblem(provider)
    if (laneProblem) return this.fail(input, provider, model, null, laneProblem)

    // 1.5 Production posture (S1): a project that configures `runtime.sandbox`
    // runs its cordis workers inside the fly-sprites VM — the jailed child
    // re-enters this runtime with `alreadyJailed` so it cannot recurse. The
    // env kill-switch (WAYPOINT_SANDBOX=off) is the operator's explicit dev seam;
    // with it set the run falls through to today's local composition.
    const hostEnv = this.config.env ?? process.env
    if (
      this.config.sandbox !== undefined &&
      sandboxEnabledForProject(this.config.sandbox, hostEnv) &&
      this.config.alreadyJailed !== true
    ) {
      return runCordisJailed(
        input,
        { provider, model, modelClass },
        {
          sandbox: this.config.sandbox,
          ...(this.config.managedBinding !== undefined ? { managedBinding: this.config.managedBinding } : {}),
          ...(this.config.roots ? { roots: this.config.roots } : {}),
          ...(this.config.sandboxProvider ? { sandboxProvider: this.config.sandboxProvider } : {}),
          ...(this.config.env ? { env: this.config.env } : {}),
          ...(this.config.timeoutMs ? { timeoutMs: this.config.timeoutMs } : {}),
          ...(this.config.maxTurns ? { maxTurns: this.config.maxTurns } : {}),
          ...(this.config.lane ? { lane: this.config.lane } : {}),
          ...(this.config.lanePicker ? { lanePicker: this.config.lanePicker } : {}),
          ...(this.config.guestEntry ? { guestEntry: this.config.guestEntry } : {}),
          ...(this.config.guestToolServer ? { guestToolServer: this.config.guestToolServer } : {}),
        },
      )
    }

    // 2. Stage the claim file (the report seam, rsc-452). Cleared on retry so a
    // prior attempt's claim can never be read as this attempt's verdict.
    const claimFile = claimHostPath(input.projectRoot, input.routeId, input.taskId)
    if (input.priorAttempt !== undefined) await rm(claimFile, { force: true })
    const claimDir = join(input.projectRoot, '.waypoint', 'claims', input.routeId)
    await mkdir(claimDir, { recursive: true })

    // 3. Compose. Every named capability resolves here or the attempt fails
    // before a model is reached — and the failure says which name and which path.
    const roots = this.config.roots ?? {}
    // Ordered, first hit wins: explicit override, then the project's own skills
    // root, then the catalog copy the installer keeps current, then the bundle
    // itself for a source checkout. A shipped recipe's skills therefore resolve
    // without anyone hand-copying them into the case.
    const skillsRoots = [
      ...(this.config.skillsRoots ?? []),
      ...(roots.skills ? [join(input.projectRoot, roots.skills.path)] : []),
      join(input.projectRoot, '.waypoint', 'skills'),
      await bundledSkillsRoot(),
    ]
    const caseRoot = this.rootPath(input.projectRoot, roots, 'case')
    const tmpDir = cordisTmpDir(input.projectRoot, input.routeId, input.taskId)
    const scratchDir = cordisScratchDir(input.projectRoot, input.routeId, input.taskId)

    let worker: Awaited<ReturnType<typeof composeCordisWorker>>
    try {
      worker = await composeCordisWorker({
        recipe: input.recipe,
        project: {
          projectRoot: input.projectRoot,
          roots,
          provider,
          model,
          skillsRoots,
          caseRoot,
        },
        dispatch: {
          routeId: input.routeId,
          taskId: input.taskId,
          prompt: input.prompt,
          ...(input.access ? { access: input.access } : {}),
          ...(input.outputArtifacts ? { outputArtifacts: input.outputArtifacts } : {}),
          ...(input.fanoutItem ? { fanoutItem: input.fanoutItem } : {}),
        },
        toolServer: this.config.toolServer ?? bundledToolServer(),
        tmpDir,
        scratchDir,
        claimDir,
        claimPath: claimFile,
        ...(this.config.env ? { env: this.config.env } : {}),
        ...(this.config.alreadyJailed ? { alreadyJailed: true } : {}),
      })
    } catch (error) {
      const why = error instanceof CordisCompositionError ? error.message : errText(error)
      return this.fail(input, provider, model, null, `composition refused: ${why}`)
    }

    const digest = worker.digest
    try {
      // 4. Mount the provider adapter and the loop. The adapter receives the
      // system prompt and tool schemas PER GENERATE from the loop (kernel
      // contract), so mount order no longer races the tool surface — but the
      // credential check still runs here, before any turn is paid for.
      const maxTurns = input.recipe.runtime?.max_turns ?? this.config.maxTurns ?? DEFAULT_MAX_TURNS
      try {
        await worker.ctx.plugin(cordisLlmPiAi, {
          provider,
          model,
          ...(this.config.resolverFactory ? { resolverFactory: this.config.resolverFactory } : {}),
        })
        // The report seam terminates the run: a worker that has filed its
        // claim is done, and does not owe the host a closing paragraph.
        await worker.ctx.plugin(agentLoopPlugin, { terminateTools: ['report'], maxSteps: maxTurns })
      } catch (error) {
        return this.fail(input, provider, model, digest, `provider '${provider}' could not be composed — ${errText(error)}`)
      }

      // 5. Run, under both a budget and the dispatch's abort signal.
      const budgetMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const controller = new AbortController()
      let timedOut = false
      // An ALREADY-aborted signal never fires 'abort', so seeding from
      // `.aborted` is not belt-and-braces — without it a cancellation that
      // lands before the dispatch reaches this runtime is reported as `failed`
      // ("ended without a report") instead of `stopped`, and a deliberate stop
      // reads as a broken worker.
      let aborted = input.signal?.aborted === true
      const onAbort = (): void => {
        aborted = true
        controller.abort()
      }
      if (aborted) controller.abort()
      input.signal?.addEventListener('abort', onAbort, { once: true })
      const budget = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, budgetMs)

      let runError: string | null = null
      let nudged = false
      try {
        await worker.ctx.agentLoop.runTurn(
          input.prompt.trim() === '' ? '(no recipe prompt — consult the recipe manifest)' : input.prompt,
          controller.signal,
        )
        // The report seam terminates the run, so a runTurn that RETURNS with
        // no claim on disk means the model ended its turn in prose instead of
        // calling `report` — witnessed live with gpt-5.3-codex-spark on the
        // 13-tool extract surface (item 54, 2026-08-30): four clean working
        // turns, then a text sign-off and a claimless failure. One bounded,
        // visible nudge; a second prose ending is a real failure and stays one.
        if (!controller.signal.aborted && (await readSandboxClaim(input.projectRoot, input.routeId, input.taskId)) === null) {
          nudged = true
          console.error('[cordis] the run ended with no claim filed — nudging once for the report tool')
          await worker.ctx.agentLoop.runTurn(
            'You have not filed your report. Call the `report` tool now with your status and a one-line summary of what you did. Do not answer in text.',
            controller.signal,
          )
        }
      } catch (error) {
        const message = errText(error)
        // The kernel loop throws on step exhaustion; the record keeps naming
        // the budget in the operator's terms. Out of turns is NOT a finish.
        runError =
          message === `agent loop exceeded ${maxTurns} steps without terminating`
            ? `the worker used all ${maxTurns} turns without finishing`
            : message
      } finally {
        clearTimeout(budget)
        input.signal?.removeEventListener('abort', onAbort)
      }
      const refusedTools: readonly string[] = worker.blockedTools

      // 6. Derive the verdict. Terminal conditions win over the claim.
      if (aborted) return this.output(input, provider, model, digest, 'stopped', null, 'run aborted', refusedTools)
      if (timedOut) {
        return this.output(
          input,
          provider,
          model,
          digest,
          'exhausted',
          null,
          `run exceeded the ${Math.round(budgetMs / 1000)}s budget`,
          refusedTools,
        )
      }

      const claim = await readSandboxClaim(input.projectRoot, input.routeId, input.taskId)
      if (runError !== null) {
        return this.output(input, provider, model, digest, 'failed', claim, `cordis loop error: ${runError}`, refusedTools)
      }
      if (claim === null) {
        return this.output(
          input,
          provider,
          model,
          digest,
          'failed',
          null,
          nudged
            ? 'the run ended without a report — the worker never filed a claim, even after the report nudge'
            : 'the run ended without a report — the worker never filed a claim',
          refusedTools,
        )
      }
      const claimStatus = typeof claim.status === 'string' ? claim.status : null
      if (claimStatus !== 'finished') {
        const summary = typeof claim.summary === 'string' ? `: ${claim.summary}` : ''
        return this.output(
          input,
          provider,
          model,
          digest,
          'failed',
          claim,
          `agent reported '${claimStatus ?? 'unknown'}'${summary}`,
          refusedTools,
        )
      }
      const summary = typeof claim.summary === 'string' && claim.summary !== '' ? claim.summary : 'finished'
      return this.output(input, provider, model, digest, 'finished', claim, summary, refusedTools)
    } finally {
      // The MCP child dies with the worker on EVERY path — success, failure,
      // abort and throw alike. A runtime that leaks one child per attempt is
      // the bridge-accumulation problem with a new name.
      await worker.dispose().catch(() => undefined)
    }
  }

  /** A named root's absolute path, or the project root when it is not declared. */
  private rootPath(
    projectRoot: string,
    roots: Readonly<Record<string, WaypointProjectRootConfig>>,
    name: string,
  ): string {
    const config = roots[name]
    return config ? join(projectRoot, config.path) : projectRoot
  }

  private fail(
    input: CordisRecipeRuntimeInput,
    provider: string | null,
    model: string | null,
    digest: string | null,
    reason: string,
  ): CordisRecipeRuntimeOutput {
    return this.output(input, provider, model, digest, 'failed', null, reason, [])
  }

  private output(
    input: CordisRecipeRuntimeInput,
    provider: string | null,
    model: string | null,
    digest: string | null,
    status: CordisRecipeRuntimeStatus,
    report: Record<string, unknown> | null,
    closeReason: string | null,
    blocked: readonly string[],
  ): CordisRecipeRuntimeOutput {
    return {
      status,
      runtime: 'cordis',
      recipe: input.recipe.slug,
      task_id: input.taskId,
      route_id: input.routeId,
      report,
      close_reason: closeReason,
      provider,
      model,
      composition_digest: digest,
      blocked_tools: blocked,
    }
  }
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
