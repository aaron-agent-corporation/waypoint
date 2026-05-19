import { resolveWaypointRouteBlocker, resumeWaypointRoute } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runResumeCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) return fail(io, routeId.error)

  try {
    const route = args.includes('--resolve-blocker')
      ? await resolveWaypointRouteBlocker(io.cwd ?? process.cwd(), {
          routeId: routeId.value,
          note: readOptionalOption(args, '--note') ?? undefined,
        })
      : await resumeWaypointRoute(io.cwd ?? process.cwd(), { routeId: routeId.value })
    if (args.includes('--json')) {
      io.stdout(JSON.stringify({ route }, null, 2))
      return 0
    }
    io.stdout(args.includes('--resolve-blocker') ? `Resolved blocker for route ${route.id}` : `Resumed route ${route.id}`)
    io.stdout(`status: ${route.status}`)
    io.stdout(`current node: ${route.current_node}`)
    return 0
  } catch (error) {
    return fail(io, error instanceof Error ? error.message : String(error))
  }
}

function fail(io: WaypointCliIo, message: string): number {
  io.stderr(message)
  return 1
}

function readRequiredOption(args: readonly string[], name: string): { ok: true; value: string } | { ok: false; error: string } {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}

function readOptionalOption(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return null
  return value
}
