import {
  findWaypointProjectRoot,
  loadBundledWaypointCatalog,
  loadWorkspaceWaypointCatalog,
  type BundledWaypointCatalog,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * Load the catalog for a CLI listing command: the workspace overlay when a
 * project root is found, else the bundled catalog. A load failure — e.g. the
 * curated bundle failing its strict parse on the no-project path — is surfaced as
 * a clean stderr line + `null` return, never an unhandled rejection (waypoint-bae #4).
 */
export async function loadCliCatalog(io: WaypointCliIo): Promise<BundledWaypointCatalog | null> {
  const projectRoot = await findWaypointProjectRoot(io.cwd ?? process.cwd())
  try {
    return projectRoot ? await loadWorkspaceWaypointCatalog(projectRoot) : await loadBundledWaypointCatalog()
  } catch (err) {
    io.stderr(`Failed to load the Waypoint catalog: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
