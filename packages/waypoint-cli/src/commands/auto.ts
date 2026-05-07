import { listWaypointAutopilotRuns, runWaypointAutopilot } from '../../../waypoint-folder-host/src/autopilot/run.ts'

import type { WaypointCliIo } from '../bin.ts'

export async function runAutoCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()

  if (args[0] === 'status') {
    const limit = positiveIntegerFlag(args, '--limit') ?? 50
    const offset = nonNegativeIntegerFlag(args, '--offset') ?? 0
    const page = await listWaypointAutopilotRuns(projectRoot, { limit, offset })
    if (args.includes('--json')) {
      io.stdout(JSON.stringify(page, null, 2))
      return 0
    }
    io.stdout('Waypoint autopilot runs')
    io.stdout(`total: ${page.total}`)
    for (const run of page.items) {
      io.stdout(`- ${run.id} ${run.route_id}`)
      io.stdout(`  status: ${run.status}`)
      io.stdout(`  iterations: ${run.iterations}`)
      io.stdout(`  blocked node: ${run.blocked_node ?? 'none'}`)
    }
    return 0
  }

  const routeId = valueAfter(args, '--route-id') ?? undefined
  const maxIterations = positiveIntegerFlag(args, '--max-iterations') ?? undefined
  const result = await runWaypointAutopilot(projectRoot, { routeId, maxIterations })

  if (args.includes('--json')) {
    io.stdout(JSON.stringify(result, null, 2))
    return 0
  }

  io.stdout('Waypoint autopilot')
  io.stdout(`route: ${result.routeId}`)
  io.stdout(`status: ${result.status}`)
  io.stdout(`iterations: ${result.iterations}`)
  io.stdout(`blocked node: ${result.blockedNode ?? 'none'}`)
  io.stdout(`completed tasks: ${result.completedTasks.length > 0 ? result.completedTasks.join(', ') : 'none'}`)
  return 0
}

function valueAfter(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}

function positiveIntegerFlag(args: readonly string[], flag: string): number | null {
  const raw = valueAfter(args, flag)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function nonNegativeIntegerFlag(args: readonly string[], flag: string): number | null {
  const raw = valueAfter(args, flag)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`)
  return parsed
}
