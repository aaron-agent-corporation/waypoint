import { listWaypointRuntimeOpenDispatches, listWaypointRuntimeRoutes, listWaypointRuntimeTasks, readRouteEvents } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runRoutesCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const routes = await listWaypointRuntimeRoutes(projectRoot)
  // The consumer's "is this run waiting on a human?" question must be
  // answered from the TASK KIND, not the node's name — a gate named
  // `setup-human-review` is still a gate (found in vivo:
  // the runs console's "gate" name heuristic left it undecidable).
  const tasks = await listWaypointRuntimeTasks(projectRoot)
  // A task's status is the last RECORDED outcome — `failed` from attempt one
  // while the auto-retry's attempt two is actively running. The open
  // dispatches are what tell a retrying run from a stopped one; without them
  // the board filed a live chronology QC under Failed (Aaron 2026-08-14).
  const openDispatches = await listWaypointRuntimeOpenDispatches(projectRoot)
  const enriched = await Promise.all(routes.map(async (route) => {
    const current = route.current_node
      ? tasks.find((task) => task.route_id === route.id && task.plan_ref === route.current_node)
      : undefined
    const kind = current?.kind ?? null
    // A gate whose LATEST decision is a rejection is "changes requested",
    // not "awaiting approval" — the consumer must render them differently
    // (found in vivo: a rejected gate sat in the inbox looking undecided).
    let gateRejected: { note: string | null; at: string } | null = null
    if (kind === 'gate' && route.status === 'blocked') {
      try {
        const page = await readRouteEvents(projectRoot, route.id, { limit: 500 })
        const decisions = [...page.items]
          .filter((event) => event.kind === 'route.gate.approved' || event.kind === 'route.gate.rejected')
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
        const latest = decisions[decisions.length - 1]
        if (latest && latest.kind === 'route.gate.rejected') {
          const payload = latest.payload as { note?: unknown } | undefined
          gateRejected = {
            note: typeof payload?.note === 'string' ? payload.note : null,
            at: latest.created_at,
          }
        }
      } catch {
        // Event read failure never breaks the listing; the gate just reads
        // as awaiting decision.
      }
    }
    // The route row's status is an operator annotation and can outlive the
    // truth: a resume sets it back to 'active' whether or not anything is
    // going to run. The current node's TASK status is what actually happened
    // there, so consumers can tell a live run from a stalled one.
    const attemptRunning = route.current_node !== null && openDispatches.some(
      (dispatch) => dispatch.route_id === route.id && dispatch.task_ref === route.current_node,
    )
    return {
      ...route,
      current_node_kind: kind,
      current_node_status: current?.status ?? null,
      // True while an attempt for the current node is queued or in flight —
      // the task may still read `failed` from the attempt before it.
      current_node_attempt_running: attemptRunning,
      gate_rejected: gateRejected,
    }
  }))

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ routes: enriched }, null, 2))
    return 0
  }

  io.stdout('Runs')
  io.stdout(`total: ${enriched.length}`)
  for (const route of enriched) {
    io.stdout(`- ${route.id}`)
    io.stdout(`  status: ${route.status}`)
    io.stdout(`  quest: ${route.quest}`)
    io.stdout(`  current node: ${route.current_node ?? 'none'}${route.current_node_kind ? ` (${route.current_node_kind})` : ''}`)
    if (route.gate_rejected) {
      io.stdout(`  gate rejected: changes requested${route.gate_rejected.note ? ` — ${route.gate_rejected.note}` : ''}`)
    }
  }
  return 0
}
