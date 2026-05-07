import { listWaypointTasks } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runTasksCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const routeId = valueAfter(args, '--route-id')
  const tasks = (await listWaypointTasks(projectRoot)).filter((task) => !routeId || task.route_id === routeId)

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ tasks }, null, 2))
    return 0
  }

  io.stdout('Waypoint tasks')
  io.stdout(`total: ${tasks.length}`)
  for (const task of tasks) {
    const discussion = discussionMetadata(task.metadata)
    io.stdout(`- ${task.id} ${task.plan_ref}`)
    io.stdout(`  status: ${task.status}`)
    io.stdout(`  kind: ${task.kind}`)
    io.stdout(`  phase: ${task.phase}`)
    if (typeof discussion.agent === 'string') io.stdout(`  agent: ${discussion.agent}`)
  }
  return 0
}

function valueAfter(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}

function discussionMetadata(metadata: unknown): Record<string, unknown> {
  const outer = isRecord(metadata) ? metadata : {}
  const waypoint = isRecord(outer.waypoint) ? outer.waypoint : {}
  return isRecord(waypoint.discussion) ? waypoint.discussion : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
