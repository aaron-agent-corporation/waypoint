import { writeWaypointRunDossier } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * `waypoint dossier --route-id <id> [--session <conv-id>]... [--note <text>]...
 * [--console-url <url>] [--json]` — write the run's reviewable record
 * (rsc-9y6, docs/designs/run-dossier.md) to `.waypoint/reports/<route-id>/`:
 * the engine-side run record joined with the Console operator sessions that
 * drove it. Snapshot semantics — safe mid-flight, rerun to refresh.
 */
export async function runDossierCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const routeId = readStringOption(args, '--route-id')
  if (routeId === null) {
    io.stderr('Missing required option: --route-id')
    return 1
  }
  const consoleUrl = readStringOption(args, '--console-url') ?? undefined

  try {
    const result = await writeWaypointRunDossier(io.cwd ?? process.cwd(), {
      routeId,
      ...(consoleUrl !== undefined ? { consoleUrl } : {}),
      sessionIds: readRepeatedOption(args, '--session'),
      notes: readRepeatedOption(args, '--note'),
    })
    if (args.includes('--json')) {
      io.stdout(JSON.stringify(result, null, 2))
      return 0
    }
    io.stdout(`Dossier written: ${result.markdownPath}`)
    io.stdout(`machine copy: ${result.jsonPath}`)
    io.stdout(
      result.sessionsUnavailable
        ? 'operator sessions: Console unavailable — run record written without transcripts'
        : `operator sessions captured: ${result.sessionsLinked}`,
    )
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function readRepeatedOption(args: readonly string[], option: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) continue
    const value = args[index + 1]
    if (value && !value.startsWith('--')) values.push(value)
  }
  return values
}
