import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import {
  parseRecipeManifest,
  questIsAvailable,
} from '@waypoint/core'
import { loadWorkspaceWaypointCatalog } from '../catalog/workspace.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** The project's git HEAD, or null when the project is not a git repo. */
async function gitHeadOf(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })
    return stdout.trim()
  } catch {
    return null
  }
}

import { isDurablePostgresRouteBackend } from '../project/backend.ts'
import { isProductionSandboxBackend, readWaypointProjectConfig, recipeRuntimeProblem, type WaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import {
  brainFamilyAmbiguityHold,
  laneBrainHold,
  readBrainReserve,
  type BrainReserve,
} from '../pgdurable/brain-reserve.ts'
import {
  contestedAccountHold,
  foreignAccountHomes,
} from '../sandbox/lane-credential-duplicates.ts'
import { laneBrokerSupportHold } from '../runtime/lane-cred-broker.ts'
import { CORDIS_GUEST_DIST_ENV } from '../runtime/cordis-jailed-runtime.ts'
import { resolveCordisGuestDist } from '../sandbox/cordis-guest-dist.ts'
import { sandboxMountHashForConfig, type ManagedRouteSandboxMetadata } from '../runtime/managed-cloud-sandbox.ts'
import { loadProviderRegistry, resolveModelTarget, type ProviderRegistry } from '../runtime/model-routing.ts'
import { readSandboxBindingRecord } from '../sandbox/binding-record.ts'
import { sandboxConfigProblem, sandboxEnabledForProject } from '../sandbox/gate.ts'
import {
  anthropicWorkerLaneRefusal,
  listSubscriptionHomes,
  oauthLaneIdForSubscription,
  workerLaneConsoleProviderForPiProvider,
  type SubscriptionHome,
} from '../sandbox/oauth-lane-resolve.ts'
import {
  laneCredentialHold,
  readLaneCredentialHealth,
  type LaneCredentialHealth,
} from '../sandbox/lane-credential-health.ts'
import { canonicalizeSandboxEgressAllowlist, policyHashForEgress } from '../sandbox/provider.ts'
import { loadSandboxAdmissionRecord } from '../sandbox/providers/cloud.ts'
import { DEFAULT_MOUNT_PATH } from '../sandbox/runtime.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { registerBridgeProject } from '../pgdurable/bridge-registry.ts'
import { startDurableRoute } from '../pgdurable/engine.ts'
import { applyQuestScaffold, type AppliedQuestScaffoldSummary } from '../quests/scaffold.ts'
import { expandQuestFanoutFromDisk } from '../quests/fanout.ts'
import { extractScaffoldPlans, materializeQuestTasks, taskKindFor, type ScaffoldPlan } from '../tasks/store.ts'
import { createWaypointRoute } from './store.ts'

export interface StartQuestRouteOptions {
  readonly quest: string
  readonly now?: Date
  /** Env consulted for the Console session id (test seam; default process.env). */
  readonly env?: NodeJS.ProcessEnv
  /** Extra top-level route metadata merged alongside runner/backend (e.g. the reconciler's (workstream, entity_key) binding). */
  readonly metadata?: Record<string, unknown>
}

export interface StartedQuestRoute extends WaypointFolderRoute {
  readonly backend: WaypointRouteBackendMode
  readonly scaffold: AppliedQuestScaffoldSummary
}

import type { WaypointFolderRoute } from './types.ts'

export async function startQuestRoute(projectRoot: string, options: StartQuestRouteOptions): Promise<StartedQuestRoute> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  const catalog = await loadWorkspaceWaypointCatalog(projectRoot)
  const resolved = catalog.resolveQuestRecipes(options.quest)
  if (resolved.ok === false) {
    throw new Error(resolved.message)
  }

  // Validate that every referenced recipe is runtime-valid before materializing
  // the route — catches prompt-less recipes at start time, not at autopilot run.
  const recipeViews: StartRecipeRuntimeView[] = []
  for (const entry of resolved.recipeEntries) {
    const parsedRecipe = parseRecipeManifest(await readFile(entry.path, 'utf8'))
    if (!parsedRecipe.ok) {
      throw new Error(
        `Quest '${options.quest}' references a recipe that is not runtime-valid: ${entry.path}: ${parsedRecipe.error.message}`,
      )
    }
    recipeViews.push({
      slug: parsedRecipe.manifest.slug,
      ...(parsedRecipe.manifest.runtime?.kind ? { kind: parsedRecipe.manifest.runtime.kind } : {}),
      ...(parsedRecipe.manifest.runtime?.model_class
        ? { modelClass: parsedRecipe.manifest.runtime.model_class }
        : {}),
    })
  }

  // rsc-m23.7: expand fan-out plans BEFORE anything reads the plan list, so
  // task materialization, the df compiler and the when-probe all see the N
  // real plans. A fan-out that cannot resolve refuses here, before any route
  // rows exist — a step covering zero items is the failure this closes.
  const rawLocalQuest = await readLocalQuestManifest(projectRoot, options.quest)
  // D5 (2026-08-24): a Quest that has never been proven end to end does not
  // start. Refuse here, before any route rows exist — the alternative is a
  // user discovering an unexercised money-handling workstream by running it.
  if (!questIsAvailable(rawLocalQuest.metadata)) {
    throw new Error(
      `Quest '${rawLocalQuest.slug}' is not yet available: it has never been proven end to end. ` +
        'Prove it on a synthetic case, then remove the "Availability: not yet available" line from its .prose source.',
    )
  }
  const localQuest = await expandQuestFanoutFromDisk(projectRoot, rawLocalQuest)
  // X4: only the durable engine has a loop primitive — starting a repeating
  // quest on the folder backend would silently drop the repeat (the exact
  // class of semantic loss the df-operator track exists to close). Fail closed.
  if (localQuest.repeat !== undefined && !(await isDurablePostgresRouteBackend(projectRoot))) {
    throw new Error(
      `Quest '${localQuest.slug}' repeats (repeat.every_days) — repeating quests require the durable postgres backend (backend.postgres.durable: true); the ${config.backend.route} backend has no loop primitive.`,
    )
  }
  // Q1 (docs/designs/q-quest-proving.md): a quest with recipe plans needs a
  // runtime that can honestly execute them — refuse BEFORE any rows exist,
  // not after the route parks forever at its first recipe wave.
  assertRuntimeExecutesRecipePlans(config, extractScaffoldPlans(localQuest.scaffolds), localQuest.slug)
  // S2 (item 52): the admitted sandbox binding rides the DURABLE ROUTE ROW —
  // dispatch admission reads it from there, not from a file the operator can
  // swap mid-route. Read + refuse here, before any rows exist.
  const sandboxBinding = await sandboxRouteBindingForStart(
    projectRoot,
    config,
    extractScaffoldPlans(localQuest.scaffolds),
    localQuest.slug,
    recipeViews,
  )
  const scaffold = await applyQuestScaffold(projectRoot, { quest: localQuest, now: options.now })
  const firstNode = firstLifecyclePhaseSlug(localQuest) ?? null
  const subject = { type: 'project', id: 'local' }

  const route = await createWaypointRoute(projectRoot, {
    quest: localQuest.slug,
    status: 'active',
    current_node: firstNode,
    subject,
    metadata: {
      ...routeMetadata(localQuest, config.backend.route, consoleSessionId(options.env ?? process.env)),
      ...(sandboxBinding === undefined ? {} : { sandbox: sandboxBinding }),
      ...(options.metadata ?? {}),
    },
    now: options.now,
  })

  // Gate-review baseline (Aaron's directive 2026-07-22: a gate must have
  // something to review): record the git HEAD the run started from so the
  // review diff is baseline→now, immune to interim checkpoint commits that
  // would otherwise blank a worktree-only diff. Best-effort: non-git
  // projects simply omit it.
  const gitHead = await gitHeadOf(projectRoot)
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.started',
    payload: {
      quest: localQuest.slug,
      recipes: resolved.recipes.length,
      lifecycle: scaffold,
      ...(gitHead ? { git_head: gitHead } : {}),
    },
    now: options.now,
  })

  await materializeQuestTasks(projectRoot, { route, quest: localQuest, now: options.now })

  // Durable postgres backend (P2/B2): hand the materialized route to the
  // pg_durable engine — it advances tasks/gates/waits from here on. A quest
  // with no scaffold plans has nothing to execute and gets NO engine
  // instance (the compiler refuses empty graphs) — the route materializes
  // exactly as before, unless it repeats: a repeating quest must reach the
  // compiler so its missing body fails closed instead of silently not
  // looping (X4).
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    if (extractScaffoldPlans(localQuest.scaffolds).length > 0 || localQuest.repeat !== undefined) {
      await startDurableRoute(projectRoot, { routeId: route.id, quest: localQuest })
      // A1: tell the Console's bridge supervisor this project has live
      // durable work — the touch is what un-parks a parked bridge.
      await registerBridgeProject(projectRoot)
    }
  }

  return { ...route, backend: config.backend.route, scaffold }
}

/**
 * Q1: shared by startQuestRoute and startAdhocRoute. Exported for those two
 * seams only — the check must run before any route rows are written.
 */
export function assertRuntimeExecutesRecipePlans(
  config: WaypointProjectConfig,
  plans: readonly ScaffoldPlan[],
  questSlug: string,
): void {
  if (!plans.some((plan) => taskKindFor(plan.metadata) === 'recipe')) return
  const problem = recipeRuntimeProblem(config.runtime)
  if (problem !== undefined) {
    throw new Error(`Quest '${questSlug}' contains recipe plans that no configured runtime can execute: ${problem}`)
  }
  // Sandbox admission rides the same seam (rsc-3yf): an egress/credential
  // policy that cannot carry a dispatch must refuse here, before any route rows
  // exist, rather than stranding a worker at its first network call.
  if (sandboxEnabledForProject(config.runtime.sandbox)) {
    const sandboxProblem = sandboxConfigProblem(config.runtime.sandbox!)
    if (sandboxProblem !== undefined) {
      throw new Error(`Quest '${questSlug}' cannot start under the configured worker sandbox: ${sandboxProblem}`)
    }
  }
}

/**
 * S2 (item 52): the admitted sandbox binding for a starting route, from the
 * per-project provisioning record. Shared by startQuestRoute and
 * startAdhocRoute — the same two seams as {@link assertRuntimeExecutesRecipePlans}.
 *
 * The record is stamped onto the route row's metadata so dispatch-time
 * admission reads the DURABLE record the route started under, not whatever the
 * file says later — a mid-route re-provision changes new routes, never running
 * ones. A production sandbox with no provisioning record refuses the start
 * (the first dispatch would only fail later, inside a route that already has
 * rows); the env kill-switch (WAYPOINT_SANDBOX=off) is the operator explicitly
 * running unjailed, so it starts without one — but a record that exists is
 * stamped regardless, as provenance.
 */
export interface StartRecipeRuntimeView {
  readonly slug: string
  readonly kind?: string
  readonly modelClass?: string
}

/** Test seams for the L5 start gate. Production callers pass nothing. */
export interface SandboxStartGateSeams {
  readonly env?: NodeJS.ProcessEnv
  /** Delta 5(a): the admission verify. Default `loadSandboxAdmissionRecord`. */
  readonly loadAdmission?: () => { readonly selected_provider: string }
  readonly homes?: readonly SubscriptionHome[]
  readonly reserve?: BrainReserve
  readonly credentialHealth?: LaneCredentialHealth
  readonly foreignAccounts?: ReadonlyMap<string, string>
  readonly registry?: ProviderRegistry
  readonly subsRoot?: string
}

/**
 * L5 delta 5(b): every model class the quest's cordis recipes use must map to
 * a provider with ≥1 signed-in NON-BRAIN worker lane — refuse at start, not
 * after N burned dispatches. Capability, not identity: no sprite is created or
 * checked here; lanes are picked and realized per dispatch.
 */
async function assertWorkerLanesForStart(
  config: WaypointProjectConfig,
  recipes: readonly StartRecipeRuntimeView[],
  questSlug: string,
  seams: SandboxStartGateSeams,
): Promise<void> {
  const cordis = recipes.filter((recipe) => recipe.kind === 'cordis')
  if (cordis.length === 0) return
  const env = seams.env ?? process.env
  const registry = seams.registry ?? (await loadProviderRegistry(env))
  const reserve = seams.reserve ?? (await readBrainReserve(env))
  const homes =
    seams.homes ??
    listSubscriptionHomes({
      ...(seams.subsRoot ? { root: seams.subsRoot } : {}),
      env,
    })
  // "Signed in" is a file-shape test — a home with token material. A lane whose
  // credential the provider has since REFUSED is signed-in on disk and useless
  // in fact (item 54: a run started against four such lanes and burned all 21
  // attempts), so the gate counts only lanes nothing is holding out.
  const health = seams.credentialHealth ?? readLaneCredentialHealth(env)
  // Dedicated-accounts policy (Aaron, 2026-08-29): an account another tool on
  // this machine also signs into is held out here, not discovered mid-run when
  // that tool's next refresh invalidates the token Waypoint is holding.
  const foreign =
    seams.foreignAccounts ?? (homes.length > 0 ? foreignAccountHomes() : new Map<string, string>())
  const checked = new Set<string>()
  for (const recipe of cordis) {
    const modelClass = recipe.modelClass ?? 'high'
    if (checked.has(modelClass)) continue
    checked.add(modelClass)
    const resolved = resolveModelTarget(modelClass as never, {
      modelTargets: config.runtime.model_targets,
      registry,
    })
    if (!resolved.ok) {
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: model class '${modelClass}' ` +
          `(recipe '${recipe.slug}') does not resolve — ${resolved.reason}`,
      )
    }
    const provider = resolved.target.provider
    const laneProblem = anthropicWorkerLaneRefusal(provider)
    if (laneProblem) {
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: model class '${modelClass}' — ${laneProblem}`,
      )
    }
    const consoleProvider = workerLaneConsoleProviderForPiProvider(provider)
    if (!consoleProvider) {
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: model class '${modelClass}' resolves ` +
          `to provider '${provider}', which has no worker-lane subscription mapping (known: openai-codex→codex, kimi, xai→grok).`,
      )
    }
    // A provider Waypoint cannot broker is not a lane however it is signed in —
    // refuse on the capability before the home list matters.
    const brokerHold = laneBrokerSupportHold(consoleProvider)
    if (brokerHold) {
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: model class ` +
          `'${modelClass}' resolves to provider '${provider}' and ${brokerHold}.`,
      )
    }
    const signedIn = homes.filter((home) => home.provider === consoleProvider && home.signedIn)
    const ambiguityHold = brainFamilyAmbiguityHold(provider, reserve)
    const holdFor = (home: SubscriptionHome): string | null =>
      laneBrainHold(home.email ?? undefined, reserve) ??
      ambiguityHold ??
      contestedAccountHold(home.homePath, foreign) ??
      laneCredentialHold(oauthLaneIdForSubscription(home.id), health, home.homePath)
    const candidates = signedIn.filter((home) => holdFor(home) === null)
    if (candidates.length === 0) {
      const heldNote =
        signedIn.length > 0
          ? ` (${signedIn.length} signed-in lane(s) held out: ${signedIn
              .map((home) => `${home.id} — ${holdFor(home)}`)
              .join('; ')})`
          : ''
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: no usable ${consoleProvider} ` +
          `worker lane for model class '${modelClass}'${heldNote} — sign one in under Console → Settings → Subscriptions.`,
      )
    }
  }
}

export async function sandboxRouteBindingForStart(
  projectRoot: string,
  config: WaypointProjectConfig,
  plans: readonly ScaffoldPlan[],
  questSlug: string,
  recipes: readonly StartRecipeRuntimeView[] = [],
  seams: SandboxStartGateSeams = {},
): Promise<ManagedRouteSandboxMetadata | undefined> {
  const sandbox = config.runtime.sandbox
  if (sandbox === undefined) return undefined
  if (!plans.some((plan) => taskKindFor(plan.metadata) === 'recipe')) return undefined
  // A present-but-corrupt record throws out of readSandboxBindingRecord — that
  // refusal is deliberate at start too, never read as "no sandbox here".
  const record = await readSandboxBindingRecord(projectRoot)
  if (!(isProductionSandboxBackend(sandbox.backend) && sandboxEnabledForProject(sandbox))) {
    // Dev/fake backends and the explicit env kill-switch: stamp whatever
    // record exists, as provenance — nothing is gated.
    return record
  }

  // L5 delta 5(a): the provider admission record must VERIFY at start — the
  // operator's signature on where case data runs, checked before any rows.
  let admission: { readonly selected_provider: string }
  try {
    admission = (seams.loadAdmission ?? loadSandboxAdmissionRecord)()
  } catch (error) {
    throw new Error(
      `Quest '${questSlug}' cannot start under the configured worker sandbox: the provider admission record does ` +
        `not verify — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (admission.selected_provider !== sandbox.backend) {
    throw new Error(
      `Quest '${questSlug}' cannot start under the configured worker sandbox: the admission record selects ` +
        `'${admission.selected_provider}' but runtime.sandbox.backend is '${sandbox.backend}'.`,
    )
  }

  // L5 delta 5(b): capability, not identity.
  await assertWorkerLanesForStart(config, recipes, questSlug, seams)

  // The route stamp is ADMISSION CONTEXT — project identity plus the hashes
  // dispatch will enforce — never a per-project sprite identity (lane sprites
  // are realized at dispatch; per-project sprite provisioning is retired, and
  // existing project sprites are destroyed only by an operator, D-B). The
  // provisioning record remains the project-identity anchor: a context-only
  // record (no sprite fields) is fully sufficient.
  if (record === undefined || typeof record.project_id !== 'string' || record.project_id.trim() === '') {
    throw new Error(
      `Quest '${questSlug}' cannot start under the configured worker sandbox: the project has no provisioning record ` +
        '(.waypoint/sandbox/binding.json) naming its project_id — write the admission-context record first ' +
        '(deploy/sandbox/provision-sprite.ts --context-only).',
    )
  }
  const egress = canonicalizeSandboxEgressAllowlist(sandbox.egress.allow ?? [])
  if (egress.length === 0) {
    throw new Error(
      `Quest '${questSlug}' cannot start under the configured worker sandbox: runtime.sandbox.egress.allow is ` +
        'empty — Sprites treats an empty rule list as unrestricted egress (fail closed).',
    )
  }
  const env = seams.env ?? process.env
  // One resolver on BOTH legs (route-013, 2026-08-31): this used to read
  // digest.txt only under the env var while dispatch resolves env-or-installed,
  // so a freshly installed bundle over a stale provisioning record stamped the
  // old digest and every dispatch refused on drift. The record digest is now
  // only the fallback when no bundle is resolvable at all.
  const guestDistResolution = resolveCordisGuestDist(env)
  let imageDigest = record.sandbox_image
  if (guestDistResolution.dist) {
    try {
      imageDigest = (await readFile(join(guestDistResolution.dist, 'digest.txt'), 'utf8')).trim()
    } catch (error) {
      throw new Error(
        `Quest '${questSlug}' cannot start under the configured worker sandbox: guest bundle at ` +
          `${guestDistResolution.dist} (source: ${guestDistResolution.source}) has an unreadable digest.txt — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (typeof imageDigest !== 'string' || imageDigest.trim() === '') {
    throw new Error(
      `Quest '${questSlug}' cannot start under the configured worker sandbox: no expected guest-bundle revision — ` +
        `set ${CORDIS_GUEST_DIST_ENV} to the built guest dist, or record sandbox_image in the provisioning record.`,
    )
  }
  return {
    project_id: record.project_id.trim(),
    sandbox_provider: sandbox.backend,
    sandbox_image: imageDigest.trim(),
    // Recomputed from the LIVE config: the provider recomputes and enforces
    // this same hash at every POST (delta 6), so an egress edit mid-route
    // refuses at dispatch instead of silently running under a different policy.
    sandbox_policy: policyHashForEgress(egress),
    sandbox_mount: sandboxMountHashForConfig(sandbox.mount_path ?? DEFAULT_MOUNT_PATH, config.roots),
    sandbox_workspace:
      typeof record.sandbox_workspace === 'string' && record.sandbox_workspace.trim() !== ''
        ? record.sandbox_workspace
        : `ws-${record.project_id.trim()}`,
  }
}

async function readLocalQuestManifest(projectRoot: string, questSlug: string): Promise<LocalQuestManifest> {
  const paths = getWaypointProjectPaths(projectRoot)
  const filePath = join(paths.runnerDir, 'quests', `${questSlug}.yaml`)
  const parsed = yamlParse(await readFile(filePath, 'utf8')) as Record<string, unknown> | null
  if (!parsed || parsed.schema_version !== 1 || typeof parsed.slug !== 'string' || typeof parsed.workflow !== 'string') {
    throw new Error(`Invalid local Quest manifest: ${filePath}`)
  }
  return {
    schema_version: 1,
    slug: parsed.slug,
    name: typeof parsed.name === 'string' ? parsed.name : parsed.slug,
    workflow: parsed.workflow,
    ...(Array.isArray(parsed.recipes) ? { recipes: parsed.recipes.filter((entry): entry is string => typeof entry === 'string') } : {}),
    ...(parsed.scaffolds !== undefined ? { scaffolds: parsed.scaffolds } : {}),
    ...(parsed.repeat !== undefined ? { repeat: parsed.repeat } : {}),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  }
}

function firstLifecyclePhaseSlug(quest: LocalQuestManifest): string | null {
  const scaffolds = quest.scaffolds
  if (!isRecord(scaffolds) || !Array.isArray(scaffolds.workstreams)) return null
  for (const workstream of scaffolds.workstreams) {
    if (!isRecord(workstream) || !Array.isArray(workstream.milestones)) continue
    for (const milestone of workstream.milestones) {
      if (!isRecord(milestone) || !Array.isArray(milestone.phases)) continue
      for (const phase of milestone.phases) {
        if (isRecord(phase) && typeof phase.phase_slug === 'string') return phase.phase_slug
      }
    }
  }
  return null
}

/**
 * The Console session that started this run (rsc-9y6), read from the env it
 * exports into every terminal it owns. Recorded so the run dossier can link
 * operator transcripts by IDENTITY rather than by its workspace-path heuristic
 * (which over-matches when several projects share a parent and misses entirely
 * when the operator works from somewhere else).
 *
 * Absent is a normal, expected state — a run started from a plain shell, a
 * cron, or a test has no session — so it is simply omitted. It is never
 * REQUIRED: making the substrate's start path depend on the Console being the
 * one to invoke it would be a worse trade than an occasionally unlinked
 * dossier, and the workspace heuristic remains as the fallback.
 */
function consoleSessionId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.WAYPOINT_SESSION_ID?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

function routeMetadata(
  quest: LocalQuestManifest,
  backend: WaypointRouteBackendMode,
  sessionId: string | undefined,
): Record<string, unknown> {
  return {
    runner: {
      workflow: quest.workflow,
      recipes: quest.recipes ?? [],
      ...(sessionId === undefined ? {} : { console_session_id: sessionId }),
    },
    backend: {
      route: backend,
    },
  }
}

interface LocalQuestManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly workflow: string
  readonly recipes?: readonly string[]
  readonly scaffolds?: unknown
  /** X4: quest-level repeat (validated by the df compiler at start). */
  readonly repeat?: unknown
  /** Authored quest metadata (D5 reads `runner.availability` from here). */
  readonly metadata?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
