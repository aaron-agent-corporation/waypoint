import { readFile } from 'node:fs/promises'

import { parseWaypointProjectConfig } from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

export interface WaypointProjectStatus {
  readonly projectRoot: string
  readonly waypointDir: string
  readonly configPath: string
  readonly initialized: boolean
  readonly enabled: boolean
  readonly quest: string | null
}

export async function readWaypointStatus(projectRoot: string): Promise<WaypointProjectStatus> {
  const paths = getWaypointProjectPaths(projectRoot)

  try {
    const text = await readFile(paths.configPath, 'utf8')
    const config = parseWaypointProjectConfig(text)

    return {
      ...paths,
      initialized: true,
      enabled: config.enabled,
      quest: config.quest,
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ...paths,
        initialized: false,
        enabled: false,
        quest: null,
      }
    }

    throw error
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
