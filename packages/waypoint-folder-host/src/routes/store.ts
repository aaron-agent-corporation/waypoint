import { createWaypointRoutePg, getWaypointRoutePg, listWaypointRoutesPg, updateWaypointRoutePg } from '../postgres/store.ts'

import type { CreateWaypointRouteInput, WaypointFolderRoute } from './types.ts'

// Backend note: these store functions are the single persistence seam for
// route state, backed by the project's postgres schema. The folder (YAML)
// backend was retired in P5 (docs/designs/p5-folder-retirement.md); legacy
// folder projects move over with `waypoint migrate`.

export async function createWaypointRoute(
  projectRoot: string,
  input: CreateWaypointRouteInput,
): Promise<WaypointFolderRoute> {
  return createWaypointRoutePg(projectRoot, input)
}

export async function listWaypointRoutes(projectRoot: string): Promise<WaypointFolderRoute[]> {
  return listWaypointRoutesPg(projectRoot)
}

export async function getWaypointRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute | null> {
  return getWaypointRoutePg(projectRoot, routeId)
}

export async function updateWaypointRoute(
  projectRoot: string,
  routeId: string,
  patch: Partial<Pick<WaypointFolderRoute, 'status' | 'current_node' | 'updated_at' | 'metadata'>>,
): Promise<WaypointFolderRoute> {
  return updateWaypointRoutePg(projectRoot, routeId, patch)
}
