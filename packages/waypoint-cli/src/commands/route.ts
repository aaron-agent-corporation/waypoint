import { cancelWaypointRoute, findAbandonedRoutes, getWaypointRuntimeRoute, reapAbandonedRoutes } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runRouteCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  // rsc-jtm: `waypoint route reap [--stale-hours N] [--cancel] [--json]` — find
  // durable routes abandoned mid-run (parked on a recipe wait no bridge is
  // progressing) and, with --cancel, stop them. DRY-RUN by default: a parked
  // run may be legitimately waiting (gate/timer) or a retry the operator means
  // to resume, so the operator sees the classification before anything is
  // cancelled. Gate/wait/timer-parked runs are never reaped by age.
  if (args[0] === 'reap') {
    const staleHours = readStaleHours(args)
    if (staleHours.ok === false) {
      io.stderr(staleHours.error)
      return 1
    }
    const candidates = await findAbandonedRoutes(io.cwd ?? process.cwd(), { staleHours: staleHours.value })
    const reapable = candidates.filter((c) => c.reapable)
    const doCancel = args.includes('--cancel')

    if (args.includes('--json')) {
      const results = doCancel ? await reapAbandonedRoutes(io.cwd ?? process.cwd(), reapable, reapReason(staleHours.value)) : []
      io.stdout(JSON.stringify({ stale_hours: staleHours.value, cancelled: doCancel, candidates, results }, null, 2))
      return 0
    }

    if (candidates.length === 0) {
      io.stdout('No non-terminal durable routes — nothing to reap.')
      return 0
    }
    for (const c of candidates) {
      io.stdout(`${c.reapable ? 'REAP  ' : 'keep  '}${c.routeId} (${c.quest}) — ${c.classification}`)
    }
    io.stdout('')
    if (reapable.length === 0) {
      io.stdout('No abandoned routes to reap.')
      return 0
    }
    if (!doCancel) {
      io.stdout(`${reapable.length} route(s) look abandoned. Re-run with --cancel to stop them.`)
      return 0
    }
    const results = await reapAbandonedRoutes(io.cwd ?? process.cwd(), reapable, reapReason(staleHours.value))
    const ok = results.filter((r) => r.ok).length
    for (const r of results.filter((r) => !r.ok)) io.stderr(`failed to reap ${r.routeId}: ${r.error}`)
    io.stdout(`Reaped ${ok} of ${reapable.length} abandoned route(s).`)
    return results.every((r) => r.ok) ? 0 : 1
  }

  // X6: `waypoint route cancel --route-id <id> [--reason <text>]` — the
  // operator surface for stopping a route (and the only sanctioned way to
  // end a repeating quest). The durable engine instance is cancelled first;
  // the route row and a route.cancelled event record it.
  if (args[0] === 'cancel') {
    const cancelRouteId = readRequiredOption(args, '--route-id')
    if (cancelRouteId.ok === false) {
      io.stderr(cancelRouteId.error)
      return 1
    }
    try {
      const cancelled = await cancelWaypointRoute(io.cwd ?? process.cwd(), {
        routeId: cancelRouteId.value,
        reason: readOptionalOption(args, '--reason'),
      })
      io.stdout(`Cancelled run ${cancelled.id}`)
      io.stdout(`status: ${cancelled.status}`)
      return 0
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) {
    io.stderr(routeId.error)
    return 1
  }

  const route = await getWaypointRuntimeRoute(io.cwd ?? process.cwd(), routeId.value)
  if (!route) {
    io.stderr(`Route not found: ${routeId.value}`)
    return 1
  }

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ route }, null, 2))
    return 0
  }

  io.stdout(`Run ${route.id}`)
  io.stdout(`quest: ${route.quest}`)
  io.stdout(`status: ${route.status}`)
  io.stdout(`current node: ${route.current_node ?? 'none'}`)
  io.stdout(`subject: ${route.subject.type}/${route.subject.id}`)
  io.stdout(`created_at: ${route.created_at}`)
  io.stdout(`updated_at: ${route.updated_at}`)
  if (route.metadata) {
    io.stdout(`metadata: ${JSON.stringify(route.metadata)}`)
  }
  return 0
}

function reapReason(staleHours: number): string {
  return `Reaped by \`waypoint route reap\`: abandoned durable route parked on a recipe wait for >= ${staleHours}h with no bridge progressing it (rsc-jtm)`
}

const DEFAULT_REAP_STALE_HOURS = 24

function readStaleHours(args: readonly string[]): { ok: true; value: number } | { ok: false; error: string } {
  const raw = readOptionalOption(args, '--stale-hours')
  if (raw === undefined) return { ok: true, value: DEFAULT_REAP_STALE_HOURS }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: `--stale-hours must be a non-negative number, got: ${raw}` }
  return { ok: true, value }
}

function readRequiredOption(args: readonly string[], name: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = readOptionalOption(args, name)
  if (!value) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}

function readOptionalOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}
