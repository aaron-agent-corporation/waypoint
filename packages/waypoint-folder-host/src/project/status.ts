import { readFile } from 'node:fs/promises'

import { listWaypointRoutes } from '../routes/store.ts'

import { parseWaypointProjectConfig } from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

import type { WaypointFolderRoute } from '../routes/types.ts'

export interface WaypointProjectStatus {
  readonly projectRoot: string
  readonly waypointDir: string
  readonly configPath: string
  readonly initialized: boolean
  readonly enabled: boolean
  readonly quest: string | null
  readonly routes: {
    readonly total: number
    readonly active: number
    readonly blocked: number
    readonly blockedGates: number
  }
}

export async function readWaypointStatus(projectRoot: string): Promise<WaypointProjectStatus> {
  const paths = getWaypointProjectPaths(projectRoot)

  try {
    const text = await readFile(paths.configPath, 'utf8')
    const config = parseWaypointProjectConfig(text)
    const routes = await listWaypointRoutes(projectRoot)

    return {
      ...paths,
      initialized: true,
      enabled: config.enabled,
      quest: config.quest,
      routes: summarizeRoutes(routes),
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ...paths,
        initialized: false,
        enabled: false,
        quest: null,
        routes: emptyRouteSummary(),
      }
    }

    throw error
  }
}

function summarizeRoutes(routes: readonly WaypointFolderRoute[]): WaypointProjectStatus['routes'] {
  return {
    total: routes.length,
    active: routes.filter((route) => route.status === 'active').length,
    blocked: routes.filter((route) => route.status === 'blocked').length,
    blockedGates: 0,
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
