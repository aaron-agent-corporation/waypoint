import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { getWaypointProjectPaths } from '../project/root.ts'

import type { CreateWaypointRouteInput, WaypointFolderRoute } from './types.ts'

const ROUTE_SCHEMA_VERSION = 1
const ROUTE_FILE_PATTERN = /^route-\d{3}\.yaml$/

export async function createWaypointRoute(
  projectRoot: string,
  input: CreateWaypointRouteInput,
): Promise<WaypointFolderRoute> {
  const existingRoutes = await listWaypointRoutes(projectRoot)
  const timestamp = timestampFor(input.now)
  const route: WaypointFolderRoute = {
    id: nextRouteId(existingRoutes),
    quest: input.quest,
    status: input.status ?? 'active',
    current_node: input.current_node ?? null,
    subject: input.subject,
    created_at: timestamp,
    updated_at: timestamp,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }

  const routesDir = routesDirectory(projectRoot)
  await mkdir(routesDir, { recursive: true })
  await writeFile(routeFilePath(projectRoot, route.id), yamlStringify({ schema_version: ROUTE_SCHEMA_VERSION, route }), 'utf8')
  return route
}

export async function listWaypointRoutes(projectRoot: string): Promise<WaypointFolderRoute[]> {
  const routesDir = routesDirectory(projectRoot)
  let fileNames: string[]
  try {
    fileNames = await readdir(routesDir)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }

  const routeFiles = fileNames.filter((name) => ROUTE_FILE_PATTERN.test(name)).sort()
  const routes = await Promise.all(routeFiles.map((fileName) => readRouteFile(join(routesDir, fileName))))
  return routes.sort((left, right) => left.id.localeCompare(right.id))
}

export async function getWaypointRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute | null> {
  try {
    return await readRouteFile(routeFilePath(projectRoot, routeId))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

export async function updateWaypointRoute(
  projectRoot: string,
  routeId: string,
  patch: Partial<Pick<WaypointFolderRoute, 'status' | 'current_node' | 'updated_at' | 'metadata'>>,
): Promise<WaypointFolderRoute> {
  const existing = await getWaypointRoute(projectRoot, routeId)
  if (!existing) throw new Error(`Route not found: ${routeId}`)
  const updated: WaypointFolderRoute = { ...existing, ...patch }
  await writeFile(routeFilePath(projectRoot, routeId), yamlStringify({ schema_version: ROUTE_SCHEMA_VERSION, route: updated }), 'utf8')
  return updated
}

async function readRouteFile(filePath: string): Promise<WaypointFolderRoute> {
  const parsed = yamlParse(await readFile(filePath, 'utf8')) as { route?: WaypointFolderRoute } | null
  if (!parsed?.route) {
    throw new Error(`Invalid Waypoint route file: ${filePath}`)
  }
  return parsed.route
}

function nextRouteId(routes: readonly WaypointFolderRoute[]): string {
  const nextNumber = routes.reduce((max, route) => {
    const match = /^route-(\d+)$/.exec(route.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `route-${String(nextNumber).padStart(3, '0')}`
}

function routesDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'routes')
}

function routeFilePath(projectRoot: string, routeId: string): string {
  return join(routesDirectory(projectRoot), `${routeId}.yaml`)
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
