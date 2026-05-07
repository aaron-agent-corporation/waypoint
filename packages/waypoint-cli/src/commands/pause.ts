import { pauseWaypointRoute } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runPauseCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) return fail(io, routeId.error)
  const reason = readOptionalOption(args, '--reason')

  try {
    const route = await pauseWaypointRoute(io.cwd ?? process.cwd(), { routeId: routeId.value, reason })
    io.stdout(`Paused route ${route.id}`)
    io.stdout(`status: ${route.status}`)
    if (reason) io.stdout(`reason: ${reason}`)
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
  const value = readOptionalOption(args, name)
  if (!value) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}

function readOptionalOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}
