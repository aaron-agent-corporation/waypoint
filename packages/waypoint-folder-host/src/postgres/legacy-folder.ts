import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import { getWaypointProjectPaths } from '../project/root.ts'

import type { WaypointFolderRoute } from '../routes/types.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'
import type { WaypointFolderRouteEvent } from '../events/types.ts'

/**
 * Frozen readers for the RETIRED folder route backend (P5/F3,
 * docs/designs/p5-folder-retirement.md). They exist for exactly one caller —
 * `waypoint migrate` (M6) — which moves a legacy project's `.waypoint/`
 * YAML/JSONL run state into its postgres schema. Nothing else may read or
 * write these files: the folder store left the product with F3, and these
 * readers are the preserved on-ramp, not a backend.
 */

const ROUTE_FILE_PATTERN = /^route-\d{3}\.yaml$/

/** The raw `backend.route` string in a legacy config ('folder' | 'beads'). */
export type LegacyRouteBackendValue = 'folder' | 'beads'

export interface LegacyFolderConfig {
  /** The full YAML document, preserved verbatim for the post-copy flip. */
  readonly raw: Record<string, unknown>
  readonly route: LegacyRouteBackendValue
  readonly postgres: { readonly url?: string; readonly schema?: string }
}

/**
 * Read `.waypoint/config.yaml` WITHOUT the strict parser — the strict parser
 * fails closed on retired backend values by design, and the migration tool
 * is the one place a retired value is an input rather than an error.
 * Returns null when the config already names the postgres backend.
 */
export async function readLegacyFolderConfig(projectRoot: string): Promise<LegacyFolderConfig | null> {
  const paths = getWaypointProjectPaths(projectRoot)
  const raw = yamlParse(await readFile(paths.configPath, 'utf8')) as Record<string, unknown> | null
  if (!raw || raw.schema_version !== 1) {
    throw new Error('Invalid Waypoint project config')
  }
  const backend = isRecord(raw.backend) ? raw.backend : {}
  const route = backend.route
  if (route !== 'folder' && route !== 'beads') return null
  const postgres = isRecord(backend.postgres) ? backend.postgres : {}
  return {
    raw,
    route,
    postgres: {
      ...(typeof postgres.url === 'string' && postgres.url.trim() !== '' ? { url: postgres.url } : {}),
      ...(typeof postgres.schema === 'string' && postgres.schema.trim() !== '' ? { schema: postgres.schema } : {}),
    },
  }
}

export async function readLegacyFolderRoutes(projectRoot: string): Promise<WaypointFolderRoute[]> {
  const routesDir = join(getWaypointProjectPaths(projectRoot).runnerDir, 'routes')
  let fileNames: string[]
  try {
    fileNames = await readdir(routesDir)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  const routes = await Promise.all(
    fileNames
      .filter((name) => ROUTE_FILE_PATTERN.test(name))
      .sort()
      .map(async (fileName) => {
        const parsed = yamlParse(await readFile(join(routesDir, fileName), 'utf8')) as { route?: WaypointFolderRoute } | null
        if (!parsed?.route) throw new Error(`Invalid Waypoint route file: ${join(routesDir, fileName)}`)
        return parsed.route
      }),
  )
  return routes.sort((left, right) => left.id.localeCompare(right.id))
}

export async function readLegacyFolderTasks(projectRoot: string): Promise<WaypointFolderTask[]> {
  const taskStatePath = join(getWaypointProjectPaths(projectRoot).runnerDir, 'tasks', 'tasks.yaml')
  try {
    const parsed = yamlParse(await readFile(taskStatePath, 'utf8')) as { tasks?: WaypointFolderTask[] } | null
    return Array.isArray(parsed?.tasks) ? [...parsed.tasks].sort((left, right) => left.id.localeCompare(right.id)) : []
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
}

export async function readLegacyFolderRouteEvents(projectRoot: string, routeId: string): Promise<WaypointFolderRouteEvent[]> {
  const eventsPath = join(getWaypointProjectPaths(projectRoot).runnerDir, 'events', `${routeId}.jsonl`)
  let raw: string
  try {
    raw = await readFile(eventsPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WaypointFolderRouteEvent)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
