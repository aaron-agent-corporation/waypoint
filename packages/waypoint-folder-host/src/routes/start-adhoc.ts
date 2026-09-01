import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseRecipeManifest } from '@waypoint/core'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { runWaypointAutopilot } from '../autopilot/run.ts'
import type { RunWaypointAutopilotResult } from '../autopilot/types.ts'
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
import { registerBridgeProject } from '../pgdurable/bridge-registry.ts'
import { startDurableRoute } from '../pgdurable/engine.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { readWaypointProjectConfig } from '../project/config.ts'
import { applyQuestScaffold, type AppliedQuestScaffoldSummary } from '../quests/scaffold.ts'
import { extractScaffoldPlans, materializeQuestTasks } from '../tasks/store.ts'
import { assertRuntimeExecutesRecipePlans, sandboxRouteBindingForStart } from './start.ts'
import { createWaypointRoute } from './store.ts'
import type { WaypointFolderRoute } from './types.ts'

/**
 * A typed manifest-validation failure. The engine boundary maps this to an
 * `EngineError` with code `VALIDATION` and the carried `field` (Task 10),
 * rather than a generic backend error.
 */
export class AdhocManifestError extends Error {
  readonly field: string

  constructor(message: string, field: string) {
    super(message)
    this.name = 'AdhocManifestError'
    this.field = field
  }
}

export interface StartAdhocRouteOptions {
  readonly sessionId: string
  readonly questYaml: string
  readonly recipeYamls?: readonly string[]
  /** When true, materialize the route + tasks but do not execute the autopilot. */
  readonly dryRun?: boolean
  readonly signal?: AbortSignal
  readonly now?: Date
}

export interface StartedAdhocRoute extends WaypointFolderRoute {
  readonly backend: 'postgres'
  readonly scaffold: AppliedQuestScaffoldSummary
  /** Absolute path to the session overlay catalog dir backing this route. */
  readonly overlay: string
  /** Present when `dryRun` is false — the executed autopilot result. */
  readonly autopilot?: RunWaypointAutopilotResult
}

interface AdhocQuestManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly workflow: string
  readonly recipes?: readonly string[]
  readonly scaffolds?: unknown
}

/**
 * Start an ad-hoc route from agent-authored drafts. The quest + recipe drafts
 * are written to the session overlay `.waypoint/agent/<sessionId>/catalog/`
 * (never the live `.waypoint/quests|recipes`), so concurrent agents never
 * collide with or shadow the curated catalog (MAR Contract Lock / CEO decision
 * 5).
 */
export async function startAdhocRoute(projectRoot: string, options: StartAdhocRouteOptions): Promise<StartedAdhocRoute> {
  if (typeof options.sessionId !== 'string' || options.sessionId.trim() === '') {
    throw new AdhocManifestError('startAdhocRoute requires a non-empty sessionId', 'sessionId')
  }

  const quest = parseAdhocQuestManifest(options.questYaml)
  const recipes = (options.recipeYamls ?? []).map((yaml, index) => parseAdhocRecipe(yaml, index))

  // Q1 (docs/designs/q-quest-proving.md): same admission as startQuestRoute.
  // A dry run only materializes rows — no execution is promised, so it passes.
  let sandboxBinding: Awaited<ReturnType<typeof sandboxRouteBindingForStart>>
  if (!options.dryRun) {
    const paths = getWaypointProjectPaths(projectRoot)
    const config = await readWaypointProjectConfig(paths.configPath)
    assertRuntimeExecutesRecipePlans(config, extractScaffoldPlans(quest.scaffolds), quest.slug)
    // S2 (item 52): ad-hoc routes carry the admitted sandbox binding on their
    // row exactly like quest routes — same refusal, same provenance.
    sandboxBinding = await sandboxRouteBindingForStart(
      projectRoot,
      config,
      extractScaffoldPlans(quest.scaffolds),
      quest.slug,
      recipes.map(({ slug, kind, modelClass }) => ({
        slug,
        ...(kind ? { kind } : {}),
        ...(modelClass ? { modelClass } : {}),
      })),
    )
  }

  const overlayDir = overlayCatalogDir(projectRoot, options.sessionId)
  const overlayQuests = join(overlayDir, 'quests')
  const overlayRecipes = join(overlayDir, 'recipes')
  await mkdir(overlayQuests, { recursive: true })
  await mkdir(overlayRecipes, { recursive: true })

  await writeFile(join(overlayQuests, `${quest.slug}.yaml`), options.questYaml, 'utf8')
  await Promise.all(
    recipes.map((recipe) => writeFile(join(overlayRecipes, `${recipe.slug}.yaml`), recipe.yaml, 'utf8')),
  )

  const scaffold = await applyQuestScaffold(projectRoot, { quest, now: options.now })
  const route = await createWaypointRoute(projectRoot, {
    quest: quest.slug,
    status: 'active',
    current_node: firstLifecyclePhaseSlug(quest),
    subject: { type: 'agent', id: options.sessionId },
    metadata: {
      ...adhocRouteMetadata(quest, options.sessionId, overlayDir),
      ...(sandboxBinding === undefined ? {} : { sandbox: sandboxBinding }),
    },
    now: options.now,
  })

  const gitHead = await gitHeadOf(projectRoot)
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.started',
    payload: { quest: quest.slug, recipes: recipes.length, adhoc: true, session_id: options.sessionId, overlay: overlayDir, lifecycle: scaffold, ...(gitHead ? { git_head: gitHead } : {}) },
    now: options.now,
  })

  await materializeQuestTasks(projectRoot, { route, quest, now: options.now })

  // Durable backend (A2, docs/designs/a-autopilot-retirement.md): hand the
  // ad-hoc route to the pg_durable engine exactly like startQuestRoute — the
  // engine advances it and the supervised bridge executes its dispatches,
  // resolving recipes from the route's persisted overlay catalog
  // (metadata.overlay). The autopilot never runs on a durable project.
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    // Same plan-less rule as startQuestRoute: nothing to execute → no engine
    // instance (adhoc manifests have no repeat field to guard).
    if (!options.dryRun && extractScaffoldPlans(quest.scaffolds).length > 0) {
      await startDurableRoute(projectRoot, { routeId: route.id, quest })
      await registerBridgeProject(projectRoot)
    }
    return { ...route, backend: 'postgres', scaffold, overlay: overlayDir }
  }

  if (options.dryRun) {
    return { ...route, backend: 'postgres', scaffold, overlay: overlayDir }
  }

  const autopilot = await runWaypointAutopilot(projectRoot, {
    routeId: route.id,
    catalogDir: overlayDir,
    signal: options.signal,
    now: options.now,
  })
  return { ...route, backend: 'postgres', scaffold, overlay: overlayDir, autopilot }
}

function parseAdhocQuestManifest(questYaml: unknown): AdhocQuestManifest {
  if (typeof questYaml !== 'string' || questYaml.trim() === '') {
    throw new AdhocManifestError('quest manifest must be a non-empty YAML string', 'questYaml')
  }
  let parsed: unknown
  try {
    parsed = yamlParse(questYaml)
  } catch (error) {
    throw new AdhocManifestError(`quest manifest is not valid YAML: ${error instanceof Error ? error.message : String(error)}`, 'questYaml')
  }
  if (!isRecord(parsed)) throw new AdhocManifestError('quest manifest top-level must be a mapping', 'questYaml')
  if (parsed.schema_version !== 1) throw new AdhocManifestError('quest manifest schema_version must be 1', 'schema_version')
  if (typeof parsed.slug !== 'string' || parsed.slug.trim() === '') {
    throw new AdhocManifestError('quest manifest requires a non-empty slug', 'slug')
  }
  if (typeof parsed.workflow !== 'string' || parsed.workflow.trim() === '') {
    throw new AdhocManifestError('quest manifest requires a non-empty workflow', 'workflow')
  }
  return {
    schema_version: 1,
    slug: parsed.slug,
    name: typeof parsed.name === 'string' ? parsed.name : parsed.slug,
    workflow: parsed.workflow,
    ...(Array.isArray(parsed.recipes) ? { recipes: parsed.recipes.filter((entry): entry is string => typeof entry === 'string') } : {}),
    ...(parsed.scaffolds !== undefined ? { scaffolds: parsed.scaffolds } : {}),
  }
}

function parseAdhocRecipe(
  recipeYaml: string,
  index: number,
): { slug: string; yaml: string; kind?: string; modelClass?: string } {
  const parsed = parseRecipeManifest(recipeYaml)
  if (!parsed.ok) {
    const field = parsed.error.path ? `recipeYamls[${index}].${parsed.error.path}` : `recipeYamls[${index}]`
    throw new AdhocManifestError(`invalid recipe manifest: ${parsed.error.message}`, field)
  }
  return {
    slug: parsed.manifest.slug,
    yaml: recipeYaml,
    ...(parsed.manifest.runtime?.kind ? { kind: parsed.manifest.runtime.kind } : {}),
    ...(parsed.manifest.runtime?.model_class ? { modelClass: parsed.manifest.runtime.model_class } : {}),
  }
}

export interface AdhocRecipeQuestOptions {
  /** Catalog slug of the recipe to run. */
  readonly recipe: string
  /** Plan title shown on the task; defaults to "Run recipe <slug>". */
  readonly title?: string
  /** Declared artifacts → output_artifacts + the derived required_paths verifier (prose convention). */
  readonly produces?: readonly string[]
  /** Vetted content contract (rsc-6al) — requires `produces`; validated against the registry at durable admission. */
  readonly contract?: string
  /** Access map `binding → ro|rw` for the Seatbelt jail. */
  readonly access?: Readonly<Record<string, string>>
  /** Uniqueness suffix for the quest slug (repeat invocations must not collide on scaffold keys). */
  readonly slugSuffix: string
}

/**
 * Synthesize the one-plan quest manifest for an ad-hoc single-recipe run
 * (the remediation seam Waypoint lacked on 2026-07-14: regenerate one
 * artifact — e.g. a placement plan under a fixed recipe — without re-running
 * a whole quest or reopening a done durable node). The emitted plan carries
 * the same metadata a prose-compiled recipe plan would: output_artifacts,
 * the derived required_paths verifier, artifact_contract, access.
 */
export function buildAdhocRecipeQuestYaml(options: AdhocRecipeQuestOptions): { slug: string; yaml: string } {
  if (typeof options.recipe !== 'string' || options.recipe.trim() === '') {
    throw new AdhocManifestError('adhoc recipe run requires a recipe slug', 'recipe')
  }
  const produces = options.produces ?? []
  if (options.contract !== undefined && produces.length === 0) {
    throw new AdhocManifestError(
      'an artifact contract judges declared artifacts — pass at least one produced path with it',
      'contract',
    )
  }
  for (const [binding, mode] of Object.entries(options.access ?? {})) {
    if (mode !== 'ro' && mode !== 'rw') {
      throw new AdhocManifestError(`access for '${binding}' must be 'ro' or 'rw', got '${mode}'`, 'access')
    }
  }

  const slug = `adhoc-${options.recipe}-${options.slugSuffix}`
  const runner: Record<string, unknown> = {
    node: { type: 'recipe' },
    recipe: { slug: options.recipe },
  }
  if (produces.length > 0) {
    runner.output_artifacts = [...produces]
    runner.artifact_verifier = {
      kind: 'required_paths',
      checks: ['exists', 'non_empty', ...(produces.some((p) => p.endsWith('/')) ? ['directory_non_empty'] : [])],
    }
  }
  if (options.contract !== undefined) runner.artifact_contract = options.contract
  if (options.access !== undefined && Object.keys(options.access).length > 0) runner.access = { ...options.access }

  const manifest = {
    schema_version: 1,
    slug,
    name: `Ad-hoc: ${options.recipe}`,
    workflow: `adhoc/${options.recipe}`,
    recipes: [options.recipe],
    scaffolds: {
      workstreams: [
        {
          key: slug,
          name: `Ad-hoc: ${options.recipe}`,
          milestones: [
            {
              version_label: 'v1',
              title: `Ad-hoc run of ${options.recipe}`,
              phases: [
                {
                  phase_key: 'ADH1',
                  phase_slug: 'run',
                  lifecycle_phase: 'execute',
                  plans: [
                    {
                      plan_ref: 'run-recipe',
                      title: options.title ?? `Run recipe ${options.recipe}`,
                      wave: 1,
                      metadata: { runner },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
  return { slug, yaml: yamlStringify(manifest) }
}

function adhocRouteMetadata(quest: AdhocQuestManifest, sessionId: string, overlayDir: string): Record<string, unknown> {
  return {
    adhoc: true,
    sessionId,
    overlay: overlayDir,
    runner: {
      workflow: quest.workflow,
      recipes: quest.recipes ?? [],
    },
    backend: { route: 'postgres' },
  }
}

function overlayCatalogDir(projectRoot: string, sessionId: string): string {
  return join(getWaypointProjectPaths(projectRoot).runnerDir, 'agent', sessionId, 'catalog')
}

function firstLifecyclePhaseSlug(quest: AdhocQuestManifest): string | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
