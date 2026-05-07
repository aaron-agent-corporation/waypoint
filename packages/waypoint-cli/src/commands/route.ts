import { getWaypointRoute } from '../../../waypoint-folder-host/src/routes/store.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runRouteCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) {
    io.stderr(routeId.error)
    return 1
  }

  const route = await getWaypointRoute(io.cwd ?? process.cwd(), routeId.value)
  if (!route) {
    io.stderr(`Route not found: ${routeId.value}`)
    return 1
  }

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ route }, null, 2))
    return 0
  }

  io.stdout(`Waypoint route ${route.id}`)
  io.stdout(`quest: ${route.quest}`)
  io.stdout(`status: ${route.status}`)
  io.stdout(`current node: ${route.current_node ?? 'none'}`)
  io.stdout(`subject: ${route.subject.type}/${route.subject.id}`)
  io.stdout(`created_at: ${route.created_at}`)
  io.stdout(`updated_at: ${route.updated_at}`)
  if (route.metadata) {
    io.stdout(`metadata: ${JSON.stringify(route.metadata)}`)
  }
  return 0
}

function readRequiredOption(args: readonly string[], name: string): { ok: true; value: string } | { ok: false; error: string } {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}
