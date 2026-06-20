import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseRecipeManifest } from '@waypoint/core'
import { parse as yamlParse } from 'yaml'

import { runWaypointAutopilot } from '../autopilot/run.ts'
import type { RunWaypointAutopilotResult } from '../autopilot/types.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { applyQuestScaffold, type AppliedQuestScaffoldSummary } from '../quests/scaffold.ts'
import { materializeQuestTasks } from '../tasks/store.ts'
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
  readonly backend: 'folder'
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
 * 5). Folder backend only in slice 2 (CEO decision 6).
 */
export async function startAdhocRoute(projectRoot: string, options: StartAdhocRouteOptions): Promise<StartedAdhocRoute> {
  if (typeof options.sessionId !== 'string' || options.sessionId.trim() === '') {
    throw new AdhocManifestError('startAdhocRoute requires a non-empty sessionId', 'sessionId')
  }

  const quest = parseAdhocQuestManifest(options.questYaml)
  const recipes = (options.recipeYamls ?? []).map((yaml, index) => parseAdhocRecipe(yaml, index))

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
    metadata: adhocRouteMetadata(quest, options.sessionId, overlayDir),
    now: options.now,
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.started',
    payload: { quest: quest.slug, recipes: recipes.length, adhoc: true, session_id: options.sessionId, overlay: overlayDir, lifecycle: scaffold },
    now: options.now,
  })

  await materializeQuestTasks(projectRoot, { route, quest, now: options.now })

  if (options.dryRun) {
    return { ...route, backend: 'folder', scaffold, overlay: overlayDir }
  }

  const autopilot = await runWaypointAutopilot(projectRoot, {
    routeId: route.id,
    catalogDir: overlayDir,
    signal: options.signal,
    now: options.now,
  })
  return { ...route, backend: 'folder', scaffold, overlay: overlayDir, autopilot }
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

function parseAdhocRecipe(recipeYaml: string, index: number): { slug: string; yaml: string } {
  const parsed = parseRecipeManifest(recipeYaml)
  if (!parsed.ok) {
    const field = parsed.error.path ? `recipeYamls[${index}].${parsed.error.path}` : `recipeYamls[${index}]`
    throw new AdhocManifestError(`invalid recipe manifest: ${parsed.error.message}`, field)
  }
  return { slug: parsed.manifest.slug, yaml: recipeYaml }
}

function adhocRouteMetadata(quest: AdhocQuestManifest, sessionId: string, overlayDir: string): Record<string, unknown> {
  return {
    adhoc: true,
    sessionId,
    overlay: overlayDir,
    waypoint: {
      workflow: quest.workflow,
      recipes: quest.recipes ?? [],
    },
    backend: { route: 'folder' },
  }
}

function overlayCatalogDir(projectRoot: string, sessionId: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'agent', sessionId, 'catalog')
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
