import { loadBundledWaypointCatalog } from '../../../waypoint-folder-host/src/catalog/bundled.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runQuestsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  if (args.length > 0) {
    io.stderr(`Unknown quests option: ${args[0]}`)
    return 1
  }

  const catalog = await loadBundledWaypointCatalog()
  io.stdout('Waypoint Quests')
  for (const quest of catalog.quests.list()) {
    io.stdout(`- ${quest.slug}: ${quest.name}`)
  }
  return 0
}
