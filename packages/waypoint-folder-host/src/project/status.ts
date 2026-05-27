import { readFile } from 'node:fs/promises'

import { listWaypointRuntimeRoutes, type WaypointRuntimeReadOptions } from '../routes/read-model.ts'
import { checkWaypointBeadsWorkspace, type WaypointBeadsWorkspaceOptions, type WaypointBeadsWorkspaceReadiness } from '../beads/workspace.ts'

import { parseWaypointProjectConfig, type WaypointRouteBackendMode } from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

import type { WaypointFolderRoute } from '../routes/types.ts'

export interface WaypointProjectStatus {
  readonly projectRoot: string
  readonly waypointDir: string
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
  readonly beads: WaypointProjectBeadsStatus | null
}

export interface WaypointProjectBeadsStatus {
  readonly readiness: WaypointBeadsWorkspaceReadiness
  readonly rootIssueIds: readonly string[]
}

export interface WaypointProjectStatusOptions extends WaypointRuntimeReadOptions {
  readonly beadsWorkspace?: WaypointBeadsWorkspaceOptions
}

export async function readWaypointStatus(
  projectRoot: string,
  options: WaypointProjectStatusOptions = {},
): Promise<WaypointProjectStatus> {
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
        beads: null,
      }
    }

    throw error
  }

  const config = parseWaypointProjectConfig(text)
  const beadsReadiness = config.backend.route === 'beads'
    ? await checkWaypointBeadsWorkspace({
      ...options.beadsWorkspace,
      cwd: options.beadsWorkspace?.cwd ?? projectRoot,
    })
    : null
  const routes = beadsReadiness && !beadsReadiness.ok
    ? []
    : await listWaypointRuntimeRoutes(projectRoot, options)

  return {
    ...paths,
    initialized: true,
    enabled: config.enabled,
    quest: config.quest,
    backend: config.backend.route,
    routes: summarizeRoutes(routes),
    beads: beadsReadiness
      ? {
        readiness: beadsReadiness,
        rootIssueIds: beadsRootIssueIds(routes),
      }
      : null,
  }
}

function beadsRootIssueIds(routes: readonly WaypointFolderRoute[]): readonly string[] {
  return routes.map((route) => {
    const beads = isRecord(route.metadata?.beads) ? route.metadata.beads : null
    return typeof beads?.issue_id === 'string' ? beads.issue_id : null
  }).filter((issueId): issueId is string => Boolean(issueId))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
