import { isDurablePostgresRouteBackend, runWaypointBridge } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * `waypoint bridge [--once] [--json] [--idle-exit-s <n>]` — the dispatch
 * bridge for durable postgres runs (P2/B3): claims `waypoint.dispatches` rows,
 * runs the project's configured recipe runtime, and signals each outcome
 * back to the parked engine. `--once` drains the currently pending
 * dispatches and exits (dev and test mode); without it the bridge stays up
 * on LISTEN/NOTIFY until interrupted. `--idle-exit-s` is the supervised
 * mode (A1): park with a clean exit after that long with no live routes or
 * dispatches — the Console's bridge supervisor respawns on the next
 * registry touch.
 */
export async function runBridgeCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  // Host pool size (P3/W4). Overrides the project config's
  // runtime.worker.concurrency; both default to 1 (sequential).
  const concurrencyIndex = args.indexOf('--concurrency')
  let concurrency: number | undefined
  if (concurrencyIndex >= 0) {
    concurrency = Number(args[concurrencyIndex + 1])
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      io.stderr('--concurrency takes a positive integer')
      return 1
    }
  }
  const idleExitIndex = args.indexOf('--idle-exit-s')
  let idleExitMs: number | undefined
  if (idleExitIndex >= 0) {
    const seconds = Number(args[idleExitIndex + 1])
    if (!Number.isFinite(seconds) || seconds <= 0) {
      io.stderr('--idle-exit-s takes a positive number of seconds')
      return 1
    }
    idleExitMs = Math.round(seconds * 1000)
  }
  if (!(await isDurablePostgresRouteBackend(projectRoot))) {
    io.stderr('waypoint bridge requires a durable postgres run backend (backend.postgres.durable: true).')
    return 1
  }
  const once = args.includes('--once')
  const json = args.includes('--json')
  const result = await runWaypointBridge(projectRoot, {
    once,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(idleExitMs !== undefined ? { idleExitMs } : {}),
    ...(json ? {} : { onEvent: (event: string) => io.stdout(`[bridge] ${event}`) }),
  })
  if (json) {
    io.stdout(JSON.stringify(result, null, 2))
    return 0
  }
  io.stdout(`Bridge processed ${result.processed.length} dispatch${result.processed.length === 1 ? '' : 'es'}`)
  for (const item of result.processed) {
    const lost = item.outcome === 'finished' && !item.engine_advanced
    io.stdout(`- dispatch ${item.dispatch_id} ${item.task_ref} (${item.recipe}): ${item.outcome}${lost ? ' [SIGNAL NOT CONSUMED]' : ''}`)
  }
  // More than one bridge legitimately serves a project — the Console registers
  // its own when a route starts. Each claim is atomic, so this is not a
  // conflict; but without these lines the tally above silently under-reports
  // the run, and a dispatch handled next door reads exactly like a step that
  // never happened.
  if (result.elsewhere.length > 0) {
    io.stdout(
      `${result.elsewhere.length} more dispatch${result.elsewhere.length === 1 ? ' was' : 'es were'} ` +
        `handled by another bridge on this schema while this one was up:`,
    )
    for (const item of result.elsewhere) {
      io.stdout(`- dispatch ${item.dispatch_id} ${item.task_ref} (${item.recipe}): ${item.status} by ${item.claimed_by}`)
    }
  }
  return result.processed.every((item) => item.outcome !== 'finished' || item.engine_advanced) ? 0 : 1
}
