import { initWaypointProject } from '../../../waypoint-folder-host/src/project/init.ts'
import { loadBundledWaypointCatalog } from '../../../waypoint-folder-host/src/catalog/bundled.ts'
import { installQuestCatalog } from '../../../waypoint-folder-host/src/catalog/install.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runInitCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readStringOption(args, '--quest') ?? 'waypoint'
  const projectRoot = io.cwd ?? process.cwd()
  const catalog = await loadBundledWaypointCatalog()
  const result = await initWaypointProject(projectRoot, { quest })
  const installed = await installQuestCatalog(projectRoot, catalog, { quest })

  io.stdout(`Initialized Waypoint project at ${result.projectRoot}`)
  io.stdout(`quest: ${result.config.quest}`)
  io.stdout(`config: ${result.waypointDir}/config.yaml`)
  io.stdout(`installed Quest manifests: ${installed.installedQuestPaths.length}`)
  io.stdout(`installed Recipe manifests: ${installed.installedRecipePaths.length}`)
  return 0
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
