import { migrateFolderProjectToPostgres } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * `waypoint migrate` — the M6 migration tool (P5/F2): move this folder
 * project's route/task/event state into its postgres schema and flip the
 * backend. Verbatim copy; folder files stay as an audit trail.
 */
export async function runMigrateCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  try {
    const result = await migrateFolderProjectToPostgres(io.cwd ?? process.cwd())
    if (args.includes('--json')) {
      io.stdout(JSON.stringify(result, null, 2))
      return 0
    }
    io.stdout('Migrated project to the postgres backend')
    io.stdout(`postgres url: ${result.url}`)
    io.stdout(`postgres schema: ${result.schema}`)
    io.stdout(`runs: ${result.routes}`)
    io.stdout(`tasks: ${result.tasks}`)
    io.stdout(`events: ${result.events}`)
    io.stdout('folder state files retained under .waypoint/ as an audit trail')
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}
