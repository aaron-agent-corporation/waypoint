import { approveRouteGate, rejectRouteGate } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runGateCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) return fail(io, routeId.error)
  const node = readRequiredOption(args, '--node')
  if (node.ok === false) return fail(io, node.error)

  const approve = args.includes('--approve')
  const reject = args.includes('--reject')
  if (approve === reject) return fail(io, 'Exactly one of --approve or --reject is required')

  const note = readOptionalOption(args, '--note')
  const nextNode = readOptionalOption(args, '--next-node')

  try {
    const updated = approve
      ? await approveRouteGate(io.cwd ?? process.cwd(), { routeId: routeId.value, node: node.value, note, nextNode })
      : await rejectRouteGate(io.cwd ?? process.cwd(), { routeId: routeId.value, node: node.value, note })

    io.stdout(`${approve ? 'Approved' : 'Rejected'} gate ${node.value} on route ${updated.id}`)
    io.stdout(`status: ${updated.status}`)
    io.stdout(`current node: ${updated.current_node ?? 'none'}`)
    if (note) io.stdout(`note: ${note}`)
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
