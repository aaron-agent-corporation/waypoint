import { getWaypointRuntimeRoute, readWaypointRuntimeRouteEvents } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runRouteEventsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) {
    io.stderr(routeId.error)
    return 1
  }

  const projectRoot = io.cwd ?? process.cwd()
  const route = await getWaypointRuntimeRoute(projectRoot, routeId.value)
  if (!route) {
    io.stderr(`Route not found: ${routeId.value}`)
    return 1
  }

  const limit = readIntegerOption(args, '--limit', 50)
  const offset = readIntegerOption(args, '--offset', 0)
  if (limit.ok === false) {
    io.stderr(limit.error)
    return 1
  }
  if (offset.ok === false) {
    io.stderr(offset.error)
    return 1
  }

  try {
    const page = await readWaypointRuntimeRouteEvents(projectRoot, routeId.value, { limit: limit.value, offset: offset.value })
    if (args.includes('--json')) {
      io.stdout(JSON.stringify({ route_id: routeId.value, ...page }, null, 2))
      return 0
    }

    io.stdout(`Run events ${routeId.value}`)
    io.stdout(`total: ${page.total}`)
    io.stdout(`limit: ${page.limit}`)
    io.stdout(`offset: ${page.offset}`)
    for (const event of page.items) {
      io.stdout(`- ${event.id} ${event.kind}`)
      io.stdout(`  created_at: ${event.created_at}`)
      if (event.payload !== undefined) {
        io.stdout(`  payload: ${JSON.stringify(event.payload)}`)
      }
    }
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function readRequiredOption(args: readonly string[], name: string): { ok: true; value: string } | { ok: false; error: string } {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}

function readIntegerOption(
  args: readonly string[],
  name: string,
  defaultValue: number,
): { ok: true; value: number } | { ok: false; error: string } {
  const index = args.indexOf(name)
  if (index === -1) return { ok: true, value: defaultValue }
  const raw = args[index + 1]
  const value = Number(raw)
  if (!raw || raw.startsWith('--') || !Number.isInteger(value)) {
    return { ok: false, error: `Option ${name} must be an integer` }
  }
  return { ok: true, value }
}
