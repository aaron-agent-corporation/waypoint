import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Agent, type AgentEvent, type AgentTool, type BeforeToolCallContext, type BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { claimHostPath, readSandboxClaim } from '../sandbox/claim.ts'
import type { WaypointProjectPiPolicyRule, WaypointProjectRootConfig, WaypointProjectSandboxConfig } from '../project/config.ts'
import { buildPiFsTools, isPiFsTool, type PiFsToolName } from './pi-fs-tools.ts'
import { runPiJailed } from './pi-jailed-runtime.ts'
import { buildPiPolicy } from './pi-policy.ts'
import { resolveModelTarget, type ModelTargets, type ProviderRegistry } from './model-routing.ts'
import type { RecipeModelClass, RecipeRuntimePriorAttempt } from './work-order.ts'

/**
 * The pi.dev worker runtime (rsc-tka, landing rsc-wwm decision A).
 *
 * A sibling of {@link WorkerRecipeRuntime}: instead of spawning `claude -p` as a
 * subprocess, it runs the IN-PROCESS `@earendil-works/pi-agent-core` loop. What
 * this buys is the thing the pivot is for — the worker starts with ZERO tools and
 * gets exactly the ones its recipe grants (least privilege as the ground state,
 * not a subtraction from a vendor list), and `beforeToolCall` is a real in-process
 * ALLOW/DENY seam for the Console policy engine.
 *
 * The seams the rest of the stack relies on are unchanged:
 *  - MODEL routing goes through the rsc-bpg registry: `model_class` -> (provider,
 *    model), subscription-first fail-closed. A non-Claude provider is finally
 *    reachable here.
 *  - The REPORT is the rsc-452 file claim: the always-present `submit_report` tool
 *    writes `.waypoint/claims/<route>/<task>.json` and `terminate`s the loop; the
 *    host reads it after the run, exactly as it does for the seatbelt/sandbox
 *    paths. The claim is the agent's CLAIM, not the verdict — this runtime judges.
 *
 * CREDENTIALS: the loop's real stream is resolved by pi-coding-agent's
 * `ModelRuntime` (reads `~/.pi/agent/auth.json`, handles OAuth + refresh), reused
 * rather than reimplemented (docs/spikes/pi-runtime). We depend on it ONLY for
 * auth/model resolution; the loop, its tools, and the enforcement are ours. The
 * resolver is injectable so tests drive a fake stream with no credentials.
 */

/** The subset of pi-coding-agent's `ModelRuntime` this runtime depends on — so a
 *  test can inject a fake and the real one satisfies it structurally. */
export interface PiModelResolver {
  getModel(providerId: string, modelId: string): Model<Api> | undefined
  hasConfiguredAuth(providerId: string): boolean
  streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream
}

/** Recipe-granted tools, keyed by name. `submit_report` is added by the runtime
 *  and must not appear here; an unknown granted name fails the attempt closed. */
export type PiToolRegistry = Readonly<Record<string, AgentTool>>

export interface PiRecipeRuntimeConfig {
  /** User provider registry (rsc-bpg) — which providers are reachable. */
  readonly registry: ProviderRegistry
  /** Project class -> {provider, model} routing (rsc-bpg). */
  readonly modelTargets?: ModelTargets
  /** Wall-clock budget; past it the run is aborted and the attempt is `exhausted`. */
  readonly timeoutMs?: number
  /** Test seam: build the model resolver. Default = the real ModelRuntime over
   *  `~/.pi/agent/auth.json`. */
  readonly resolverFactory?: () => Promise<PiModelResolver>
  /** The vetted tool registry a recipe may grant from. Default = none (a
   *  report-only worker). The built-in access-map-honoring fs tools (read_file /
   *  write_file / list_dir, pi-fs-tools.ts) are recognized WITHOUT appearing
   *  here — they are built per-task from the plan's `access:` map, not shared. */
  readonly toolRegistry?: PiToolRegistry
  /**
   * The project's named roots (`.waypoint/config.yaml` `roots:`) — the base
   * capabilities the built-in fs tools confine to (rsc-bhc), crossed with the
   * task's `access:` map exactly as the Seatbelt jail does. Absent (or a recipe
   * granting no fs tool) = a reason-and-report worker with no filesystem reach.
   */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /** microsandbox config — consulted only to FAIL CLOSED on the jailed path when
   *  a project configures the microVM (that tier is stage 2b, rsc-0fx). */
  readonly sandbox?: WaypointProjectSandboxConfig
  /** Env consulted for the jail gates + as the worker spawn base (test seam; default process.env). */
  readonly env?: NodeJS.ProcessEnv
  /** Extra worker-env allowlist names (`runtime.worker.env_allow`) for the jailed child (rsc-m8x). */
  readonly envAllow?: readonly string[]
  /** Test seam: brokered-credential source for the jailed path (default `~/.pi/agent/auth.json`). */
  readonly authPath?: string
  /** Test seam: the jailed pi child entrypoint. */
  readonly entryPath?: string
  /** Test seam: the node binary the jailed child is spawned with. */
  readonly execPath?: string
  /**
   * Set by the jailed child (pi-worker-entry.ts): the loop is ALREADY inside an
   * OS jail, so fs tools run in-process here instead of re-forking to another
   * jailed subprocess (which would recurse). The parent leaves this false so a
   * fs-tool recipe forks to the jailed child (rsc-0fx, decision A′).
   */
  readonly alreadyJailed?: boolean
  /**
   * The Console ALLOW/DENY/ASK policy seam (rsc-wwm). `beforeToolCall` fires
   * after a GRANTED tool's args validate and before it runs; returning
   * `{ block: true, reason }` denies it. This is the in-process replacement for
   * the opaque-subprocess policy hook — the whole point of the pivot. Default:
   * no policy (a granted tool runs). Least privilege itself is upstream of this:
   * only granted tools are registered at all, so this governs the ones a recipe
   * already holds, not the boundary of what it can hold.
   */
  readonly policy?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined> | BeforeToolCallResult | undefined
  /**
   * Config-driven DENY rules (`runtime.pi_policy`, rsc-bhc part 3). When `policy`
   * is not set directly (the test seam), the loop builds its `beforeToolCall`
   * policy from these via `buildPiPolicy`. Carried on the config — rather than
   * only as the built function — so the A′ fork can FORWARD the rules into the
   * jailed child, where the fs-tool loop actually runs and most needs them.
   */
  readonly piPolicy?: readonly WaypointProjectPiPolicyRule[]
}

export interface PiRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: string
  readonly prompt: string
  readonly projectRoot: string
  readonly modelClass?: RecipeModelClass
  /** Names the recipe grants from the tool registry (beyond `submit_report`). */
  readonly tools?: readonly string[]
  /** The plan's `access:` map ({binding -> 'ro' | 'rw'}) — feeds the built-in fs
   *  tools' confinement (rsc-bhc), the same map the jailed worker gets. */
  readonly access?: Readonly<Record<string, string>>
  readonly priorAttempt?: RecipeRuntimePriorAttempt
  readonly signal?: AbortSignal
}

export type PiRecipeRuntimeStatus = 'finished' | 'failed' | 'exhausted' | 'stopped'

export interface PiRecipeRuntimeOutput {
  readonly status: PiRecipeRuntimeStatus
  readonly runtime: 'pi'
  readonly recipe: string
  readonly task_id: string
  readonly route_id: string
  readonly report: Record<string, unknown> | null
  readonly close_reason: string | null
  readonly provider: string | null
  readonly model: string | null
  /** Tool calls the recipe's granted set refused — for the dossier/audit trail. */
  readonly blocked_tools: readonly string[]
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

export class PiRecipeRuntime {
  private readonly config: PiRecipeRuntimeConfig

  constructor(config: PiRecipeRuntimeConfig) {
    this.config = config
  }

  async runRecipe(input: PiRecipeRuntimeInput): Promise<PiRecipeRuntimeOutput> {
    // 1. Route the class to a concrete (provider, model), subscription-first.
    // Untagged is treated as `high` (docs/MODEL-ROUTING.md), then must resolve —
    // pi has no implicit default provider the way `claude -p` has a default model.
    const modelClass = input.modelClass ?? 'high'
    const resolved = resolveModelTarget(modelClass, { modelTargets: this.config.modelTargets, registry: this.config.registry })
    if (!resolved.ok) return this.fail(input, null, null, `model routing failed: ${resolved.reason}`)
    const { provider, model: modelId } = resolved.target

    // A′ fork (rsc-0fx): a recipe that grants an access-map fs tool must run
    // JAILED — its tools touch the filesystem, and in-process the PathGuard is a
    // software boundary only. Spawn the pi child inside the Seatbelt jail with the
    // credential brokered in. The child runs the SAME loop with `alreadyJailed`
    // set, so it does NOT recurse. Tool-less (reason-and-report) recipes, and the
    // child itself, keep the in-process path below.
    const wantsFsTools = (input.tools ?? []).some(isPiFsTool)
    if (wantsFsTools && this.config.alreadyJailed !== true) {
      return runPiJailed(
        input,
        { provider, model: modelId, modelClass },
        {
          ...(this.config.roots ? { roots: this.config.roots } : {}),
          ...(this.config.sandbox ? { sandbox: this.config.sandbox } : {}),
          ...(this.config.piPolicy ? { piPolicy: this.config.piPolicy } : {}),
          ...(this.config.env ? { env: this.config.env } : {}),
          ...(this.config.envAllow ? { envAllow: this.config.envAllow } : {}),
          ...(this.config.timeoutMs ? { timeoutMs: this.config.timeoutMs } : {}),
          ...(this.config.authPath ? { authPath: this.config.authPath } : {}),
          ...(this.config.entryPath ? { entryPath: this.config.entryPath } : {}),
          ...(this.config.execPath ? { execPath: this.config.execPath } : {}),
        },
      )
    }

    // 2. Stage the claim file (the report seam, rsc-452). Cleared on retry so a
    // prior attempt's claim cannot be read as this attempt's verdict.
    const claimFile = claimHostPath(input.projectRoot, input.routeId, input.taskId)
    if (input.priorAttempt !== undefined) await rm(claimFile, { force: true })
    await mkdir(join(input.projectRoot, '.waypoint', 'claims', input.routeId), { recursive: true })

    // 3. Resolve the model + its auth (the real ModelRuntime, or an injected fake).
    let resolver: PiModelResolver
    try {
      resolver = await (this.config.resolverFactory ?? defaultResolverFactory)()
    } catch (error) {
      return this.fail(input, provider, modelId, `could not build the pi model runtime: ${errText(error)}`)
    }
    if (!resolver.hasConfiguredAuth(provider)) {
      return this.fail(input, provider, modelId, `provider '${provider}' has no configured auth in ~/.pi/agent/auth.json (run: pi /login)`)
    }
    const model = resolver.getModel(provider, modelId)
    if (!model) return this.fail(input, provider, modelId, `model '${provider}/${modelId}' not found in the provider catalog`)

    // 4. Assemble the granted toolset: the recipe's tools (fail closed on an
    // unknown name) plus the always-present submit_report. A granted name
    // resolves in one of two ways — a built-in access-map fs tool (read_file /
    // write_file / list_dir), or an entry in the injected static registry.
    const blocked: string[] = []
    let submitted: Record<string, unknown> | null = null
    const registry = this.config.toolRegistry ?? {}
    const grantedNames = input.tools ?? []
    if (grantedNames.includes('submit_report')) {
      return this.fail(input, provider, modelId, `'submit_report' is provided by the runtime and must not be granted by a recipe`)
    }
    // Built-in fs tools are confined to THIS task's access map (rsc-bhc). Build
    // them here so the guard is per-task; a fail-closed refusal (no access map,
    // unknown binding, rw-on-ro escalation) aborts the attempt with NO tool,
    // exactly as the Seatbelt jail refuses to spawn.
    const fsNames = grantedNames.filter(isPiFsTool)
    let fsTools: Readonly<Record<string, AgentTool>> = {}
    if (fsNames.length > 0) {
      const scratchDir = join(input.projectRoot, '.waypoint', 'scratch', input.routeId, input.taskId)
      await mkdir(scratchDir, { recursive: true })
      try {
        fsTools = await buildPiFsTools({
          projectRoot: input.projectRoot,
          roots: this.config.roots,
          access: input.access,
          scratchDir,
          names: fsNames as readonly PiFsToolName[],
        })
      } catch (error) {
        return this.fail(input, provider, modelId, `in-process fs tools refused (no tool granted): ${errText(error)}`)
      }
    }
    const granted: AgentTool[] = []
    for (const name of grantedNames) {
      const tool = fsTools[name] ?? registry[name]
      if (tool === undefined) {
        return this.fail(input, provider, modelId, `recipe grants tool '${name}', which is not in the vetted tool registry — fail closed`)
      }
      granted.push(tool)
    }
    const submitReport = buildSubmitReportTool(claimFile, input.taskId, (claim) => {
      submitted = claim
    })
    const allowed = new Set<string>([...grantedNames, 'submit_report'])

    // 5. Drive the in-process loop. LEAST PRIVILEGE is layer 1 (only granted
    // tools + submit_report are registered above — an ungranted tool is not
    // reachable at all). beforeToolCall is layer 2: defense-in-depth against a
    // tool that should never be registered, then the injected Console policy
    // (ALLOW/DENY/ASK) on the granted tools.
    // A directly-injected `policy` function is the test seam; otherwise build the
    // policy from the config-driven DENY rules (rsc-bhc part 3).
    const policy = this.config.policy ?? buildPiPolicy(this.config.piPolicy)
    const agent = new Agent({
      streamFn: (m, c, o) => resolver.streamSimple(m, c, o),
      toolExecution: 'sequential',
      initialState: { model, systemPrompt: buildPiSystemPrompt(input, claimFile), tools: [submitReport, ...granted] },
      async beforeToolCall(ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> {
        const name = ctx.toolCall?.name
        if (name !== undefined && !allowed.has(name)) {
          blocked.push(name)
          return { block: true, reason: `tool '${name}' is not in this recipe's granted set` }
        }
        const verdict = policy ? await policy(ctx) : undefined
        if (verdict?.block && name !== undefined) blocked.push(name)
        return verdict
      },
    })

    let runError: string | null = null
    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'tool_execution_end' && event.isError && event.toolName === 'submit_report') {
        runError = 'submit_report failed'
      }
    })

    const budgetMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let timedOut = false
    // Seeded from `.aborted`, not only from the listener: 'abort' never fires
    // on a signal that is ALREADY aborted, so a cancellation landing before
    // this runtime is entered would be missed entirely and the attempt reported
    // as "ended without a report" — a deliberate stop reading as a broken
    // worker. `worker-spawn.ts` has always checked this up front; the
    // in-process loop did not.
    let aborted = input.signal?.aborted === true
    const onAbort = (): void => {
      aborted = true
      agent.abort()
    }
    if (aborted) agent.abort()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    const budget = setTimeout(() => {
      timedOut = true
      agent.abort()
    }, budgetMs)
    try {
      await agent.prompt(input.prompt.trim() === '' ? '(no recipe prompt — consult the recipe manifest)' : input.prompt)
      await agent.waitForIdle()
    } catch (error) {
      runError = errText(error)
    } finally {
      clearTimeout(budget)
      input.signal?.removeEventListener('abort', onAbort)
    }

    // 6. Derive the verdict. Terminal conditions win over the claim (never agent
    // say-so, 2026-05-06): an abort is `stopped`, a budget elapse is `exhausted`.
    if (aborted) return this.output(input, provider, modelId, 'stopped', submitted, 'run aborted', blocked)
    if (timedOut) return this.output(input, provider, modelId, 'exhausted', submitted, `run exceeded the ${Math.round(budgetMs / 1000)}s budget`, blocked)

    // The claim on disk is the report row. Prefer the file (the seam the host
    // reads); fall back to what submit_report captured in-process.
    const claim = (await readSandboxClaim(input.projectRoot, input.routeId, input.taskId)) ?? submitted
    if (runError !== null) return this.output(input, provider, modelId, 'failed', claim, `pi loop error: ${runError}`, blocked)
    if (claim === null) {
      return this.output(input, provider, modelId, 'failed', null, 'the run ended without a report — submit_report was never called', blocked)
    }
    const claimStatus = typeof claim.status === 'string' ? claim.status : null
    if (claimStatus !== 'finished') {
      const summary = typeof claim.summary === 'string' ? `: ${claim.summary}` : ''
      return this.output(input, provider, modelId, 'failed', claim, `agent reported '${claimStatus ?? 'unknown'}'${summary}`, blocked)
    }
    const summary = typeof claim.summary === 'string' && claim.summary !== '' ? claim.summary : 'finished'
    return this.output(input, provider, modelId, 'finished', claim, summary, blocked)
  }

  private fail(input: PiRecipeRuntimeInput, provider: string | null, model: string | null, reason: string): PiRecipeRuntimeOutput {
    return this.output(input, provider, model, 'failed', null, reason, [])
  }

  private output(
    input: PiRecipeRuntimeInput,
    provider: string | null,
    model: string | null,
    status: PiRecipeRuntimeStatus,
    report: Record<string, unknown> | null,
    closeReason: string | null,
    blocked: readonly string[],
  ): PiRecipeRuntimeOutput {
    return {
      status,
      runtime: 'pi',
      recipe: input.recipe,
      task_id: input.taskId,
      route_id: input.routeId,
      report,
      close_reason: closeReason,
      provider,
      model,
      blocked_tools: blocked,
    }
  }
}

/** The always-present report tool: writes the rsc-452 claim and ends the loop. */
function buildSubmitReportTool(claimFile: string, taskId: string, onSubmit: (claim: Record<string, unknown>) => void): AgentTool {
  return {
    name: 'submit_report',
    label: 'Submit report',
    description:
      'Report the outcome and finish. Call EXACTLY ONCE when the task is complete or you cannot complete it. ' +
      'The claim is your claim, not the verdict — the host verifies it.',
    parameters: Type.Object({
      status: Type.Union([Type.Literal('finished'), Type.Literal('failed')]),
      summary: Type.String(),
      evidence: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(_toolCallId: string, params: { status: string; summary: string; evidence?: Record<string, string> }) {
      const claim: Record<string, unknown> = {
        task_id: taskId,
        status: params.status,
        summary: params.summary,
        ...(params.evidence ? { evidence: params.evidence } : {}),
      }
      onSubmit(claim)
      const { writeFile, mkdir: mkdirp } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdirp(dirname(claimFile), { recursive: true })
      await writeFile(claimFile, JSON.stringify(claim), 'utf8')
      return { content: [{ type: 'text' as const, text: 'report recorded' }], details: {}, terminate: true }
    },
  } as AgentTool
}

function buildPiSystemPrompt(input: PiRecipeRuntimeInput, claimFile: string): string {
  const hasFsTools = (input.tools ?? []).some(isPiFsTool)
  return [
    `You are a Waypoint worker agent executing one recipe task of run ${input.routeId} (task ${input.taskId}).`,
    `Project root (all inputs and outputs): ${input.projectRoot}`,
    'You start with only the tools this recipe granted. If you need something you do not have, report failure — do not work around it.',
    ...(hasFsTools
      ? [
          'Filesystem access is confined to this task\'s access map: you may READ any file inside a granted root, but WRITE only inside a read-write root. Paths are relative to the project root. A path outside your granted roots is refused — do not try to reach around it.',
        ]
      : []),
    '',
    'Report contract:',
    '- When the task is complete and verified, call submit_report with status "finished" and a summary citing the files or checks that prove the work.',
    '- If you cannot complete the task, call submit_report with status "failed" and what went wrong.',
    '- Call submit_report EXACTLY ONCE. It is your only way to finish. The host reads your claim after you stop and derives the outcome.',
    `- (Your claim is recorded at ${claimFile}; you do not write there yourself — submit_report does.)`,
    '',
    'Hard rules: never claim work you did not do; human gates are human-only; do not attempt to reach the run database or any network you were not granted a tool for.',
  ].join('\n')
}

/** The default (production) resolver: pi-coding-agent's ModelRuntime over the
 *  user's pi auth store. Lazy-imported so the heavy pi deps load only when a pi
 *  recipe actually runs, not on every import of this package. */
async function defaultResolverFactory(): Promise<PiModelResolver> {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create({ authPath: join(homedir(), '.pi', 'agent', 'auth.json') })
  return runtime as unknown as PiModelResolver
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
