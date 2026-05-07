#!/usr/bin/env node
import rootPackage from '../../../package.json' with { type: 'json' }

const rootPackageVersion = rootPackage.version

export interface WaypointCliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const helpText = `Waypoint local folder host

Usage:
  waypoint --help
  waypoint --version

Commands for init/status/catalog/routes land in later Track 1 phases.
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
