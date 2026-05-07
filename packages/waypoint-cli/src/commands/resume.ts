import { resumeWaypointRoute } from '../../../waypoint-folder-host/src/routes/state.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runResumeCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) return fail(io, routeId.error)

  try {
    const route = await resumeWaypointRoute(io.cwd ?? process.cwd(), { routeId: routeId.value })
    io.stdout(`Resumed route ${route.id}`)
    io.stdout(`status: ${route.status}`)
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
