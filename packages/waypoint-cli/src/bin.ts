#!/usr/bin/env node
import cliPackage from '../package.json' with { type: 'json' }
import { runAutoCommand } from './commands/auto.ts'
import { runDiscussCommand } from './commands/discuss.ts'
import { runGateCommand } from './commands/gate.ts'
import { runInitCommand } from './commands/init.ts'
import { runLifecycleCommand } from './commands/lifecycle.ts'
import { runPauseCommand } from './commands/pause.ts'
import { runQuestsCommand } from './commands/quests.ts'
import { runRouteCommand } from './commands/route.ts'
import { runRouteEventsCommand } from './commands/route-events.ts'
import { runRecipesCommand } from './commands/recipes.ts'
import { runResumeCommand } from './commands/resume.ts'
import { runRoutesCommand } from './commands/routes.ts'
import { runStartCommand } from './commands/start.ts'
import { runStatusCommand } from './commands/status.ts'
import { runTasksCommand } from './commands/tasks.ts'

const rootPackageVersion = cliPackage.version

export interface WaypointCliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
  cwd?: string
}

const helpText = `Waypoint local folder host

Usage:
  waypoint --help
  waypoint --version
  waypoint init [--quest <slug>]
  waypoint status
  waypoint quests
  waypoint recipes [--quest <slug>]
  waypoint start [--quest <slug>]
  waypoint routes [--json]
  waypoint route --route-id <id> [--json]
  waypoint route-events --route-id <id> [--limit N] [--offset N] [--json]
  waypoint tasks [--route-id <id>] [--json]
  waypoint discuss --task-id <id> [--message <text>] [--author user|agent]
  waypoint auto [--route-id <id>] [--max-iterations N] [--json]
  waypoint auto status [--limit N] [--offset N] [--json]
  # Safety: local Recipe runtime executes configured commands only when .waypoint/config.yaml explicitly sets runtime.recipe: local.
  waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
  waypoint pause --route-id <id> [--reason <text>]
  waypoint resume --route-id <id>
  waypoint lifecycle add workstream --key <key> --name <name>
  waypoint lifecycle add milestone --workstream <key> --key <key> --title <title>
  waypoint lifecycle add phase --milestone <key> --key <key> --lifecycle <name>
  waypoint lifecycle add plan --phase <key> --ref <ref> --title <title>
  waypoint lifecycle list
`

export async function runWaypointCli(args: readonly string[], io: WaypointCliIo = defaultIo()): Promise<number> {
  const [command] = args

  if (command === '--version' || command === '-v') {
    io.stdout(rootPackageVersion)
    return 0
  }

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(helpText.trimEnd())
    return 0
  }

  if (command === 'init') {
    return runInitCommand(args.slice(1), io)
  }

  if (command === 'status') {
    return runStatusCommand(args.slice(1), io)
  }

  if (command === 'quests') {
    return runQuestsCommand(args.slice(1), io)
  }

  if (command === 'recipes') {
    return runRecipesCommand(args.slice(1), io)
  }

  if (command === 'lifecycle') {
    return runLifecycleCommand(args.slice(1), io)
  }

  if (command === 'start') {
    return runStartCommand(args.slice(1), io)
  }

  if (command === 'routes') {
    return runRoutesCommand(args.slice(1), io)
  }

  if (command === 'route') {
    return runRouteCommand(args.slice(1), io)
  }

  if (command === 'route-events') {
    return runRouteEventsCommand(args.slice(1), io)
  }

  if (command === 'tasks') {
    return runTasksCommand(args.slice(1), io)
  }

  if (command === 'discuss') {
    return runDiscussCommand(args.slice(1), io)
  }

  if (command === 'auto') {
    return runAutoCommand(args.slice(1), io)
  }

  if (command === 'gate') {
    return runGateCommand(args.slice(1), io)
  }

  if (command === 'pause') {
    return runPauseCommand(args.slice(1), io)
  }

  if (command === 'resume') {
    return runResumeCommand(args.slice(1), io)
  }

  io.stderr(`Unknown Waypoint command: ${command}`)
  io.stderr('Run waypoint --help for usage.')
  return 1
}

function defaultIo(): WaypointCliIo {
  return {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runWaypointCli(process.argv.slice(2))
  process.exitCode = exitCode
}
