import { startQuestRoute } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runStartCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readOption(args, '--quest') ?? 'waypoint'

  try {
    const route = await startQuestRoute(io.cwd ?? process.cwd(), { quest })
    io.stdout(`Started Waypoint route ${route.id}`)
    io.stdout(`quest: ${route.quest}`)
    io.stdout(`status: ${route.status}`)
    io.stdout(`current node: ${route.current_node ?? 'none'}`)
    io.stdout(
      `scaffolded lifecycle: ${route.scaffold.workstreams} ${plural('workstream', route.scaffold.workstreams)}, ${route.scaffold.milestones} ${plural('milestone', route.scaffold.milestones)}, ${route.scaffold.phases} ${plural('phase', route.scaffold.phases)}, ${route.scaffold.plans} ${plural('plan', route.scaffold.plans)}`,
    )
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}
