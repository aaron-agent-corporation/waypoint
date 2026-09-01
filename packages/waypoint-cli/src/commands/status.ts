import { readWaypointStatus, type WaypointProjectStatus } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runStatusCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const status = await readWaypointStatus(io.cwd ?? process.cwd())
  if (args.includes('--json')) {
    io.stdout(JSON.stringify(statusJson(status), null, 2))
    return 0
  }

  io.stdout('Project status')
  io.stdout(`project_root: ${status.projectRoot}`)
  io.stdout(`initialized: ${status.initialized}`)
  io.stdout(`enabled: ${status.enabled}`)
  io.stdout(`quest: ${status.quest ?? 'null'}`)
  io.stdout(`run backend: ${status.backend ?? 'null'}`)
  io.stdout(`runs: ${status.routes.total}`)
  io.stdout(`active runs: ${status.routes.active}`)
  io.stdout(`blocked runs: ${status.routes.blocked}`)
  io.stdout(`blocked gates: ${status.routes.blockedGates}`)
  io.stdout(`config: ${status.configPath}`)
  return 0
}

function statusJson(status: WaypointProjectStatus): Record<string, unknown> {
  return {
    project_root: status.projectRoot,
    runner_dir: status.runnerDir,
    config_path: status.configPath,
    initialized: status.initialized,
    enabled: status.enabled,
    quest: status.quest,
    backend: status.backend,
    routes: status.routes,
  }
}
