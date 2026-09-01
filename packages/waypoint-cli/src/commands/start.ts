import { startQuestRoute } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runStartCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readOption(args, '--quest') ?? 'runner'
  const json = args.includes('--json')
  const projectRoot = io.cwd ?? process.cwd()

  try {
    const route = await startQuestRoute(projectRoot, { quest })
    if (json) {
      io.stdout(JSON.stringify({
        id: route.id,
        quest: route.quest,
        backend: route.backend,
        status: route.status,
        current_node: route.current_node,
        subject: route.subject,
        scaffold: route.scaffold,
      }))
      return 0
    }
    io.stdout(`Started run ${route.id}`)
    io.stdout(`quest: ${route.quest}`)
    io.stdout(`run backend: ${route.backend}`)
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
  return index >= 0 ? args[index + 1] : undefined
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}
