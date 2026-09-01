import { spineTierReport } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * `waypoint tier-report [--json]` — the tier-tuning scorecard
 * (docs/MODEL-ROUTING.md): per-recipe dispatch outcomes from the durable
 * store. Reads only; requires the postgres+durable backend (dispatch rows
 * exist nowhere else).
 */
export async function runTierReportCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  try {
    const rows = await spineTierReport(io.cwd ?? process.cwd())
    if (args.includes('--json')) {
      io.stdout(JSON.stringify({ recipes: rows }, null, 2))
      return 0
    }
    if (rows.length === 0) {
      io.stdout('No dispatches recorded yet.')
      return 0
    }
    io.stdout('recipe | class | dispatches | finished/failed/exhausted/stopped/open | queue s | work s')
    for (const row of rows) {
      io.stdout(
        [
          row.recipe,
          row.model_class,
          String(row.dispatches),
          `${row.outcomes.finished}/${row.outcomes.failed}/${row.outcomes.exhausted}/${row.outcomes.stopped}/${row.outcomes.open}`,
          row.avg_queue_seconds === null ? '-' : String(row.avg_queue_seconds),
          row.avg_work_seconds === null ? '-' : String(row.avg_work_seconds),
        ].join(' | '),
      )
      if (row.last_summary !== null) io.stdout(`  last summary: ${row.last_summary}`)
    }
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}
