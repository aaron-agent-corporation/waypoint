import { readWaypointStatus } from '../../../waypoint-folder-host/src/project/status.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runStatusCommand(_args: readonly string[], io: WaypointCliIo): Promise<number> {
  const status = await readWaypointStatus(io.cwd ?? process.cwd())

  io.stdout('Waypoint project status')
  io.stdout(`project_root: ${status.projectRoot}`)
  io.stdout(`initialized: ${status.initialized}`)
  io.stdout(`enabled: ${status.enabled}`)
  io.stdout(`quest: ${status.quest ?? 'null'}`)
  io.stdout(`config: ${status.configPath}`)
  return 0
}
