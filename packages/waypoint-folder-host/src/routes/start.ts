import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { createWaypointRoute } from './store.ts'
import type { WaypointFolderRoute } from './types.ts'
import { applyQuestScaffold, type AppliedQuestScaffoldSummary } from '../quests/scaffold.ts'
import { materializeQuestTasks } from '../tasks/store.ts'

export interface StartQuestRouteOptions {
  readonly quest: string
  readonly now?: Date
}

export interface StartedQuestRoute extends WaypointFolderRoute {
  readonly scaffold: AppliedQuestScaffoldSummary
}

export async function startQuestRoute(projectRoot: string, options: StartQuestRouteOptions): Promise<StartedQuestRoute> {
  const catalog = await loadBundledWaypointCatalog()
  const resolved = catalog.resolveQuestRecipes(options.quest)
  if (resolved.ok === false) {
    throw new Error(resolved.message)
  }

  const localQuest = await readLocalQuestManifest(projectRoot, options.quest)
  const scaffold = await applyQuestScaffold(projectRoot, { quest: localQuest, now: options.now })
  const firstNode = firstLifecyclePhaseSlug(localQuest) ?? null

  const route = await createWaypointRoute(projectRoot, {
    quest: localQuest.slug,
    status: 'active',
    current_node: firstNode,
    subject: { type: 'project', id: 'local' },
    metadata: {
      waypoint: {
        workflow: localQuest.workflow,
        recipes: localQuest.recipes ?? [],
      },
    },
    now: options.now,
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.started',
    payload: {
      quest: localQuest.slug,
      recipes: resolved.recipes.length,
      lifecycle: scaffold,
    },
    now: options.now,
  })

  await materializeQuestTasks(projectRoot, { route, quest: localQuest, now: options.now })

  return { ...route, scaffold }
}

async function readLocalQuestManifest(projectRoot: string, questSlug: string): Promise<LocalQuestManifest> {
  const paths = getWaypointProjectPaths(projectRoot)
  const filePath = join(paths.waypointDir, 'quests', `${questSlug}.yaml`)
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

interface LocalQuestManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly workflow: string
  readonly recipes?: readonly string[]
  readonly scaffolds?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
