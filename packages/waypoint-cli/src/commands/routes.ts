import { listWaypointRuntimeRoutes } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runRoutesCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const routes = await listWaypointRuntimeRoutes(projectRoot)

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ routes }, null, 2))
    return 0
  }

  io.stdout('Waypoint routes')
  io.stdout(`total: ${routes.length}`)
  for (const route of routes) {
    io.stdout(`- ${route.id}`)
    io.stdout(`  status: ${route.status}`)
    io.stdout(`  quest: ${route.quest}`)
    io.stdout(`  current node: ${route.current_node ?? 'none'}`)
  }
  return 0
}
