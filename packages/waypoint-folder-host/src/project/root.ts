import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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

export async function waypointConfigExists(projectRoot: string): Promise<boolean> {
  try {
    await access(getWaypointProjectPaths(projectRoot).configPath)
    return true
  } catch {
    return false
  }
}
