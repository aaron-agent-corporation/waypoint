import { pathToFileURL } from 'node:url'

import type { WaypointProjectPiPolicyRule, WaypointProjectRootConfig } from '../project/config.ts'
import { BROKER_ENV, brokeredResolverFactory } from './pi-cred-broker.ts'
import { PiRecipeRuntime, type PiModelResolver, type PiRecipeRuntimeOutput } from './pi-runtime.ts'
import type { RecipeModelClass } from './work-order.ts'

/**
 * The JAILED pi worker child (rsc-0fx, decision A′). When a pi recipe grants a
 * side-effecting tool, the host does NOT run the loop in-process — it spawns this
 * entrypoint as a subprocess wrapped in the same Seatbelt / microsandbox jail a
 * `claude -p` worker gets (kernel-enforced confinement), with the model
 * credential brokered in via the env (pi-cred-broker.ts) rather than mounting
 * `~/.pi`.
 *
 * The child REUSES {@link PiRecipeRuntime} wholesale — the parent has already
 * resolved the model target, so the child feeds a synthetic single-provider
 * registry that routes the class straight to that (provider, model). No provider
 * registry, model-target, or `~/.pi` file is read inside the jail; the only
 * inputs are the work order on stdin and the brokered credential in the env.
 * The report is the same rsc-452 file claim the parent reads after exit.
 */

/** The structured order the parent serializes onto the child's stdin. Paths are
 *  ALREADY in the jail's coordinate space (host path on seatbelt, mount path on
 *  microsandbox) — the parent translates before spawning. */
export interface PiWorkOrder {
  readonly routeId: string
  readonly taskId: string
  readonly recipe: string
  readonly prompt: string
  readonly projectRoot: string
  readonly modelClass?: RecipeModelClass
  /** The (provider, model) the PARENT already resolved (subscription-first, fail
   *  closed). The child does not re-route from config. */
  readonly provider: string
  readonly model: string
  readonly tools?: readonly string[]
  readonly access?: Readonly<Record<string, string>>
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  /** Config-driven DENY rules (rsc-bhc part 3), forwarded so the jailed loop
   *  enforces the SAME policy as the in-process path. */
  readonly piPolicy?: readonly WaypointProjectPiPolicyRule[]
  readonly timeoutMs?: number
}

export interface RunPiWorkerChildOptions {
  readonly order: PiWorkOrder
  readonly env?: NodeJS.ProcessEnv
  /** Test seam: inject a resolver. Default builds one from the brokered credential. */
  readonly resolverFactory?: () => Promise<PiModelResolver>
  readonly signal?: AbortSignal
}

export async function runPiWorkerChild(opts: RunPiWorkerChildOptions): Promise<PiRecipeRuntimeOutput> {
  const { order } = opts
  const env = opts.env ?? process.env
  const resolverFactory =
    opts.resolverFactory ??
    (async (): Promise<PiModelResolver> => {
      const resolver = await brokeredResolverFactory(env)
      if (resolver === undefined) {
        throw new Error(`no brokered credential in ${BROKER_ENV} — the jailed pi worker cannot authenticate`)
      }
      return resolver
    })
  const modelClass: RecipeModelClass = order.modelClass ?? 'high'
  const runtime = new PiRecipeRuntime({
    // Synthetic registry + target so the class routes to exactly the (provider,
    // model) the parent chose — no config read in the jail.
    registry: { [order.provider]: { auth: 'subscription' } },
    modelTargets: { [modelClass]: { provider: order.provider, model: order.model } },
    ...(order.roots ? { roots: order.roots } : {}),
    // The child builds the SAME policy from the forwarded rules (rsc-bhc part 3).
    ...(order.piPolicy ? { piPolicy: order.piPolicy } : {}),
    ...(order.timeoutMs ? { timeoutMs: order.timeoutMs } : {}),
    // We are ALREADY inside the OS jail — run fs tools in-process, do not re-fork.
    alreadyJailed: true,
    resolverFactory,
  })
  return runtime.runRecipe({
    routeId: order.routeId,
    taskId: order.taskId,
    recipe: order.recipe,
    prompt: order.prompt,
    projectRoot: order.projectRoot,
    modelClass,
    ...(order.tools ? { tools: order.tools } : {}),
    ...(order.access ? { access: order.access } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
}

/**
 * Read the work order from stdin, run the loop, and derive the process exit from
 * the outcome — exit 0 iff the attempt finished; the report is the file claim
 * the parent reads (never stdout). SIGTERM/SIGINT abort the loop so the host's
 * process-group kill lands cleanly.
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const order = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PiWorkOrder

  const controller = new AbortController()
  process.on('SIGTERM', () => controller.abort())
  process.on('SIGINT', () => controller.abort())

  const out = await runPiWorkerChild({ order, signal: controller.signal })
  if (out.status !== 'finished') {
    process.stderr.write(`pi worker: ${out.status}: ${out.close_reason ?? ''}\n`)
    process.exitCode = 1
  } else {
    process.exitCode = 0
  }
}

// Run only when executed directly (spawned by the host), not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`pi worker: fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
