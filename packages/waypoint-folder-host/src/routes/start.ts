import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { WaypointBeadsCliIssueClient } from '../beads/cli-client.ts'
import { instantiateWaypointRouteInBeads, type WaypointBeadsIssueClient } from '../beads/instantiate.ts'
import {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  type WaypointBeadsWorkspaceOptions,
} from '../beads/workspace.ts'
import { readWaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { applyQuestScaffold, type AppliedQuestScaffoldSummary } from '../quests/scaffold.ts'
import { materializeQuestTasks } from '../tasks/store.ts'
import { createWaypointRoute, listWaypointRoutes } from './store.ts'
import type { WaypointFolderRoute } from './types.ts'

export interface StartQuestRouteOptions {
  readonly quest: string
  readonly now?: Date
  readonly beadsClient?: WaypointBeadsIssueClient
  readonly beadsWorkspace?: WaypointBeadsWorkspaceOptions
}

export interface StartedQuestRoute extends WaypointFolderRoute {
  readonly backend: WaypointRouteBackendMode
  readonly scaffold: AppliedQuestScaffoldSummary
  readonly beads?: StartedQuestRouteBeadsSummary
}

export interface StartedQuestRouteBeadsSummary {
  readonly root_issue_id: string
  readonly issue_count: number
  readonly dependency_count: number
}

export async function startQuestRoute(projectRoot: string, options: StartQuestRouteOptions): Promise<StartedQuestRoute> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  const catalog = await loadBundledWaypointCatalog()
  const resolved = catalog.resolveQuestRecipes(options.quest)
  if (resolved.ok === false) {
    throw new Error(resolved.message)
  }

  if (config.backend.route === 'beads' && !options.beadsClient) {
    const readiness = await checkWaypointBeadsWorkspace({
      ...options.beadsWorkspace,
      cwd: options.beadsWorkspace?.cwd ?? projectRoot,
    })
    if (!readiness.ok) {
      throw new Error(formatWaypointBeadsWorkspaceReadinessFailure(readiness))
    }
  }

  const localQuest = await readLocalQuestManifest(projectRoot, options.quest)
  const scaffold = await applyQuestScaffold(projectRoot, { quest: localQuest, now: options.now })
  const firstNode = firstLifecyclePhaseSlug(localQuest) ?? null
  const subject = { type: 'project', id: 'local' }

  if (config.backend.route === 'beads') {
    const existingRoutes = await listWaypointRoutes(projectRoot)
    const existingBeadsRoute = existingRoutes.find(
      (route) => route.quest === localQuest.slug && routeBackendFromMetadata(route.metadata) === 'beads',
    )
    if (existingBeadsRoute) {
      throw new Error(`Beads route already started for quest ${localQuest.slug}: ${existingBeadsRoute.id}`)
    }

    const routeId = nextRouteId(existingRoutes)
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: localQuest.slug,
      routeId,
      subject,
      client: options.beadsClient ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot }),
    })
    const beads = {
      root_issue_id: instantiated.root.beadsId,
      issue_count: instantiated.issues.length,
      dependency_count: instantiated.dependencies.length,
    }
    const route = await createWaypointRoute(projectRoot, {
      id: routeId,
      quest: localQuest.slug,
      status: 'active',
      current_node: firstNode,
      subject,
      metadata: routeMetadata(localQuest, 'beads', beads),
      now: options.now,
    })

    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.started',
      payload: {
        quest: localQuest.slug,
        recipes: resolved.recipes.length,
        backend: 'beads',
        beads,
        lifecycle: scaffold,
      },
      now: options.now,
    })

    return { ...route, backend: 'beads', scaffold, beads }
  }

  const route = await createWaypointRoute(projectRoot, {
    quest: localQuest.slug,
    status: 'active',
    current_node: firstNode,
    subject,
    metadata: routeMetadata(localQuest, 'folder'),
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

  return { ...route, backend: 'folder', scaffold }
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

function nextRouteId(routes: readonly WaypointFolderRoute[]): string {
  const nextNumber = routes.reduce((max, route) => {
    const match = /^route-(\d+)$/.exec(route.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `route-${String(nextNumber).padStart(3, '0')}`
}

function routeMetadata(
  quest: LocalQuestManifest,
  backend: WaypointRouteBackendMode,
  beads?: StartedQuestRouteBeadsSummary,
): Record<string, unknown> {
  return {
    waypoint: {
      workflow: quest.workflow,
      recipes: quest.recipes ?? [],
    },
    backend: {
      route: backend,
    },
    ...(beads ? { beads } : {}),
  }
}

function routeBackendFromMetadata(metadata: Record<string, unknown> | undefined): WaypointRouteBackendMode | null {
  const backend = isRecord(metadata?.backend) ? metadata.backend : {}
  return backend.route === 'beads' || backend.route === 'folder' ? backend.route : null
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
