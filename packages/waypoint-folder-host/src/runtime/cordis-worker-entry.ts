import { pathToFileURL } from 'node:url'

import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import type { RecipeManifest } from '@waypoint/core'

import type { WaypointProjectRootConfig } from '../project/config.ts'
import { BROKER_ENV, brokeredResolverFactory } from './pi-cred-broker.ts'
import { CordisRecipeRuntime, type CordisRecipeRuntimeOutput } from './cordis-runtime.ts'
import type { PiAiResolver } from './cordis/llm-pi-ai.ts'
import type { RecipeModelClass } from './work-order.ts'

/**
 * The JAILED Cordis worker child — the ONLY worker shape that runs in a
 * fly-sprites VM (Aaron's 2026-08-27 ruling: all workers run the Cordis
 * harness built in this repo; no third-party agent harness ever executes
 * work). The bridge stays on the host, stages the work order into the synced
 * workspace, and enters the sprite with this entrypoint reading the order on
 * stdin; the model credential is brokered via {@link BROKER_ENV} and exists
 * only in the exec session's environment — no auth store lives in the guest.
 *
 * The child reuses {@link CordisRecipeRuntime} with `alreadyJailed: true`: the
 * VM is the jail, so the runtime must not recurse into another sandbox enter,
 * and the MCP tool child spawns without the (macOS-only) seatbelt wrap.
 */

// pi-ai lazy-loads each OAuth flow through a deliberately unbundleable dynamic
// import ("so bundlers cannot follow it"); inside the esbuild guest bundle that
// import resolves beside the bundle and fails, surfacing as "OAuth auth
// derivation failed" (found live, S1 witness). This is the library's own fix
// for statically bundled builds. Which providers may RUN stays decided by the
// order's registry and by what the host brokers — the guest only ever holds
// the one credential for the order's provider, and Anthropic never rides a
// worker lane (Aaron 2026-08-27).
registerBunOAuthFlows()

/** Structured order the host serializes onto the child's stdin. Paths are in
 *  the GUEST coordinate space (the workspace mount inside the sprite), and the
 *  recipe rides as the full manifest — the guest has no catalog to resolve a
 *  slug against, and re-resolving would let the two sides disagree about what
 *  worker was composed. */
export interface CordisWorkOrder {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: RecipeManifest
  readonly prompt: string
  /** The workspace mount inside the sprite (`/work`). */
  readonly projectRoot: string
  readonly modelClass?: RecipeModelClass
  /** The (provider, model) the host already resolved, subscription-first. */
  readonly provider: string
  readonly model: string
  readonly access?: Readonly<Record<string, string>>
  readonly outputArtifacts?: readonly string[]
  readonly fanoutItem?: { readonly slug: string; readonly label: string; readonly path?: string }
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /** The baked guest MCP server — pinned by the host so the guest never
   *  package-resolves a tool surface the host did not name. */
  readonly toolServer: string
  readonly timeoutMs?: number
  readonly maxTurns?: number
}

export interface RunCordisWorkerChildOptions {
  readonly order: CordisWorkOrder
  readonly env?: NodeJS.ProcessEnv
  readonly resolverFactory?: () => Promise<PiAiResolver>
  readonly signal?: AbortSignal
}

export async function runCordisWorkerChild(opts: RunCordisWorkerChildOptions): Promise<CordisRecipeRuntimeOutput> {
  const { order } = opts
  const env = opts.env ?? process.env
  const resolverFactory =
    opts.resolverFactory ??
    (async (): Promise<PiAiResolver> => {
      const resolver = await brokeredResolverFactory(env)
      if (resolver === undefined) {
        throw new Error(
          `no brokered credential (staged file via WAYPOINT_PI_BROKERED_CRED_FILE, or ${BROKER_ENV}) — the jailed cordis worker cannot authenticate`,
        )
      }
      return resolver
    })
  const modelClass: RecipeModelClass = order.modelClass ?? order.recipe.runtime?.model_class ?? 'high'
  const runtime = new CordisRecipeRuntime({
    registry: { [order.provider]: { auth: 'subscription' } },
    modelTargets: { [modelClass]: { provider: order.provider, model: order.model } },
    ...(order.roots ? { roots: order.roots } : {}),
    toolServer: order.toolServer,
    ...(order.timeoutMs ? { timeoutMs: order.timeoutMs } : {}),
    ...(order.maxTurns ? { maxTurns: order.maxTurns } : {}),
    alreadyJailed: true,
    env,
    resolverFactory,
  })
  return runtime.runRecipe({
    routeId: order.routeId,
    taskId: order.taskId,
    recipe: order.recipe,
    prompt: order.prompt,
    projectRoot: order.projectRoot,
    modelClass,
    ...(order.access ? { access: order.access } : {}),
    ...(order.outputArtifacts ? { outputArtifacts: order.outputArtifacts } : {}),
    ...(order.fanoutItem ? { fanoutItem: order.fanoutItem } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
}

/**
 * The guest process main: order on stdin, verdict as the exit code. EXPORTED
 * so the baked launcher (`cordis-worker-launch.mjs`) can invoke it explicitly
 * — inside an esbuild bundle every module's `import.meta.url` collapses to the
 * bundle's own URL, so an argv[1] main-guard would fire for EVERY bundled CLI
 * file at once (assemble-referral-package rides in via artifact-contracts).
 * The launcher runs with its own argv[1], no guard fires, and exactly one
 * main — this one — is called.
 */
export async function cordisWorkerMain(): Promise<void> {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const order = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CordisWorkOrder

    const controller = new AbortController()
    process.on('SIGTERM', () => controller.abort())
    process.on('SIGINT', () => controller.abort())

    const out = await runCordisWorkerChild({ order, signal: controller.signal })
    if (out.status !== 'finished') {
      process.stderr.write(`cordis worker: ${out.status}: ${out.close_reason ?? ''}\n`)
      process.exitCode = 1
    } else {
      process.exitCode = 0
    }
  } catch (error) {
    process.stderr.write(`cordis worker: fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void cordisWorkerMain()
}
