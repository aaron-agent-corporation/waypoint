import { readFile } from 'node:fs/promises'

import { listWaypointRuntimeRoutes } from '../routes/read-model.ts'

import { parseWaypointProjectConfig, type WaypointRouteBackendMode } from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

import type { WaypointFolderRoute } from '../routes/types.ts'

export interface WaypointProjectStatus {
  readonly projectRoot: string
  readonly runnerDir: string
  readonly configPath: string
  readonly initialized: boolean
  readonly enabled: boolean
  readonly quest: string | null
  readonly backend: WaypointRouteBackendMode | null
  readonly routes: {
    readonly total: number
    readonly active: number
    readonly blocked: number
    readonly blockedGates: number
  }
}

export async function readWaypointStatus(projectRoot: string): Promise<WaypointProjectStatus> {
  const paths = getWaypointProjectPaths(projectRoot)

  let text: string
  try {
    text = await readFile(paths.configPath, 'utf8')
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ...paths,
        initialized: false,
        enabled: false,
        quest: null,
        backend: null,
        routes: emptyRouteSummary(),
      }
    }

    throw error
  }

  const config = parseWaypointProjectConfig(text)
  const routes = await listWaypointRuntimeRoutes(projectRoot)

  return {
    ...paths,
    initialized: true,
    enabled: config.enabled,
    quest: config.quest,
    backend: config.backend.route,
    routes: summarizeRoutes(routes),
  }
}

function summarizeRoutes(routes: readonly WaypointFolderRoute[]): WaypointProjectStatus['routes'] {
  return {
    total: routes.length,
    active: routes.filter((route) => route.status === 'active').length,
    blocked: routes.filter((route) => route.status === 'blocked').length,
    blockedGates: routes.filter((route) => route.status === 'blocked' && route.current_node?.includes('gate')).length,
  }
}

function emptyRouteSummary(): WaypointProjectStatus['routes'] {
  return {
    total: 0,
    active: 0,
    blocked: 0,
    blockedGates: 0,
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
