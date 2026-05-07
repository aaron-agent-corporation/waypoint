import { readWaypointStatus } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runStatusCommand(_args: readonly string[], io: WaypointCliIo): Promise<number> {
  const status = await readWaypointStatus(io.cwd ?? process.cwd())

  io.stdout('Waypoint project status')
  io.stdout(`project_root: ${status.projectRoot}`)
  io.stdout(`initialized: ${status.initialized}`)
  io.stdout(`enabled: ${status.enabled}`)
  io.stdout(`quest: ${status.quest ?? 'null'}`)
  io.stdout(`routes: ${status.routes.total}`)
  io.stdout(`active routes: ${status.routes.active}`)
  io.stdout(`blocked routes: ${status.routes.blocked}`)
  io.stdout(`blocked gates: ${status.routes.blockedGates}`)
  io.stdout(`config: ${status.configPath}`)
  return 0
}
