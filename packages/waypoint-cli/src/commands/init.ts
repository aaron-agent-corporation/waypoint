import { initWaypointProject } from '../../../waypoint-folder-host/src/project/init.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runInitCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readStringOption(args, '--quest') ?? 'gsd'
  const result = await initWaypointProject(io.cwd ?? process.cwd(), { quest })

  io.stdout(`Initialized Waypoint project at ${result.projectRoot}`)
  io.stdout(`quest: ${result.config.quest}`)
  io.stdout(`config: ${result.waypointDir}/config.yaml`)
  return 0
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
