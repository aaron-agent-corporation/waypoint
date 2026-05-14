import { isWizardDomain, scanWizardSource } from '@waypoint/core'

import type { WaypointCliIo } from '../bin'

export async function runWizardCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args

  if (subcommand === 'scan') {
    return runWizardScan(args.slice(1), io)
  }

  io.stderr(`Unknown Wizard subcommand: ${subcommand ?? '(none)'}`)
  io.stderr('Run waypoint wizard --help for usage.')
  return 1
}

export async function runWizardScan(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let domain: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const result = await scanWizardSource({ sourceRoot: sourcePath, domain })

    if (jsonOutput) {
      io.stdout(JSON.stringify(result, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Scan`)
      io.stdout(`=========================`)
      io.stdout(`Source: ${result.source_root}`)
      io.stdout(`Domain: ${result.domain}`)
      io.stdout(`Files found: ${result.files_found}`)
      if (result.warnings.length > 0) {
        io.stdout(`Warnings:`)
        for (const warning of result.warnings) {
          io.stdout(`  - ${warning}`)
        }
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}