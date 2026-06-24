import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const WAYPOINT_DIR_NAME = '.waypoint'

export interface WaypointProjectPaths {
  readonly projectRoot: string
  readonly waypointDir: string
  readonly configPath: string
}

export function getWaypointProjectPaths(projectRoot: string): WaypointProjectPaths {
  const resolvedRoot = resolve(projectRoot)
  const waypointDir = join(resolvedRoot, WAYPOINT_DIR_NAME)

  return {
    projectRoot: resolvedRoot,
    waypointDir,
    configPath: join(waypointDir, 'config.yaml'),
  }
}

/** Walk up from startDir (inclusive) to the nearest ancestor containing a `.waypoint/` dir; null if none. */
export async function findWaypointProjectRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  for (;;) {
    try {
      await access(join(current, WAYPOINT_DIR_NAME))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

export async function waypointConfigExists(projectRoot: string): Promise<boolean> {
  try {
    await access(getWaypointProjectPaths(projectRoot).configPath)
    return true
  } catch {
    return false
  }
}
