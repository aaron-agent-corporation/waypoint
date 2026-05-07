#!/usr/bin/env node
import rootPackage from '../../../package.json' with { type: 'json' }
import { runInitCommand } from './commands/init.ts'
import { runLifecycleCommand } from './commands/lifecycle.ts'
import { runQuestsCommand } from './commands/quests.ts'
import { runRecipesCommand } from './commands/recipes.ts'
import { runStatusCommand } from './commands/status.ts'

const rootPackageVersion = rootPackage.version

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
  waypoint lifecycle add workstream --key <key> --name <name>
  waypoint lifecycle add milestone --workstream <key> --key <key> --title <title>
  waypoint lifecycle add phase --milestone <key> --key <key> --lifecycle <name>
  waypoint lifecycle add plan --phase <key> --ref <ref> --title <title>
  waypoint lifecycle list

Route commands land in later Track 1 phases.
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
