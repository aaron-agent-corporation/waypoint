import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createWaypointProjectConfig,
  serializeWaypointProjectConfig,
  type WaypointProjectConfig,
  type WaypointRouteBackendMode,
} from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

export interface InitWaypointProjectOptions {
  readonly quest: string
  readonly backend?: WaypointRouteBackendMode
  readonly now?: Date
}

export interface InitWaypointProjectResult {
  readonly projectRoot: string
  readonly waypointDir: string
  readonly config: WaypointProjectConfig
}

const requiredStateDirectories = ['quests', 'recipes', 'lifecycle', 'routes', 'events', 'tasks'] as const

export async function initWaypointProject(
  projectRoot: string,
  options: InitWaypointProjectOptions,
): Promise<InitWaypointProjectResult> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = createWaypointProjectConfig({ quest: options.quest, backend: options.backend, now: options.now })

  await mkdir(paths.waypointDir, { recursive: true })
  await Promise.all(requiredStateDirectories.map((name) => mkdir(join(paths.waypointDir, name), { recursive: true })))
  await writeFile(paths.configPath, serializeWaypointProjectConfig(config), 'utf8')

  return {
    projectRoot: paths.projectRoot,
    waypointDir: paths.waypointDir,
    config,
  }
}
