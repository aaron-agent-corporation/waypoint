import { isDurablePostgresRouteBackend } from '../project/backend.ts'
import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import type { WaypointFolderTaskKind } from '../tasks/types.ts'
import { cancelWaypointRoute } from './state.ts'
import { listWaypointRoutes } from './store.ts'
import type { WaypointFolderRouteStatus } from './types.ts'

/**
 * Reaping abandoned durable routes (rsc-jtm).
 *
 * A durable route parks its pg_durable instance 'running' whenever it waits —
 * for a human gate, a timer, or a task signal a bridge must send. pg_durable is
 * DESIGNED to wait indefinitely, so its own reconcile never reaps a parked
 * instance, and the bridge PARKS after 60s idle by design (A1). So "no live
 * bridge" is the normal state of a legitimately-parked run, and a run that the
 * operator simply walked away from is indistinguishable from a live one: it
 * sits 'running' forever, misreporting as active work and accumulating rows
 * that bloat the shared store (the confirmed rsc-r9e mechanism — a bloated
 * df.instances table starves other runs' scheduling).
 *
 * The only parked state that CANNOT self-resolve without a live bridge is a
 * route parked on a RECIPE task: it is waiting for a dispatch that only a
 * worker bridge produces. A gate waits for a human, a wait/timer/delay fires
 * in-database — those are legitimately parked and never reaped by age. So a
 * recipe-parked route whose row has not moved for longer than the staleness
 * threshold is the abandonment signal.
 *
 * Reaping is OPERATOR-TRIGGERED, never automatic: a fresh recipe-parked route
 * may simply be mid-dispatch, and even a stale one might be a retry loop the
 * operator means to resume next week. So this module classifies; the operator
 * (via `waypoint route reap`, or a future Runs-console surface) decides. The
 * classification is exported so both callers share one definition of
 * "abandoned".
 */

const DEFAULT_STALE_HOURS = 24

/** Task kinds whose parked state resolves WITHOUT a live worker bridge — a
 * human decision (gate) or an in-database firing (wait/timer/delay). Never
 * reaped by staleness; listed as legitimately parked. */
const SELF_RESOLVING_PARK_KINDS: ReadonlySet<WaypointFolderTaskKind> = new Set(['gate', 'wait', 'timer', 'delay'])

export interface RouteReapCandidate {
  readonly routeId: string
  readonly quest: string
  readonly routeStatus: WaypointFolderRouteStatus
  readonly currentNode: string | null
  /** Task kind of the node the route is parked on (null if none/unknown). */
  readonly parkedKind: WaypointFolderTaskKind | null
  readonly instanceId: string | null
  /** pg_durable engine status of the instance (df.status), null if none. */
  readonly engineStatus: string | null
  readonly updatedAt: string
  readonly ageHours: number
  /** True only for a recipe-parked, stale, engine-running route. */
  readonly reapable: boolean
  /** One-line human-readable reason for the verdict (reaped or kept). */
  readonly classification: string
}

export interface FindAbandonedRoutesOptions {
  /** A recipe-parked route idle at least this long is abandoned. Default 24h. */
  readonly staleHours?: number
  /** Injected clock (tests); default Date.now(). */
  readonly now?: Date
}

/**
 * Classify every non-terminal durable route by whether it is an abandoned
 * recipe-parked run (reapable) or legitimately parked / fresh (kept). Returns
 * [] on a non-durable project — reaping is a durable-engine concept.
 */
export async function findAbandonedRoutes(
  projectRoot: string,
  options: FindAbandonedRoutesOptions = {},
): Promise<RouteReapCandidate[]> {
  if (!(await isDurablePostgresRouteBackend(projectRoot))) return []
  const staleHours = options.staleHours ?? DEFAULT_STALE_HOURS
  const nowMs = (options.now ?? new Date()).getTime()

  const routes = (await listWaypointRoutes(projectRoot)).filter((r) => r.status === 'active' || r.status === 'blocked')
  if (routes.length === 0) return []

  const tasks = await listWaypointTasks(projectRoot)
  const kindByRouteNode = new Map<string, WaypointFolderTaskKind>()
  for (const task of tasks) kindByRouteNode.set(`${task.route_id} ${task.plan_ref}`, task.kind)

  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const candidates: RouteReapCandidate[] = []

  for (const route of routes) {
    const instanceRow = (
      await pool.query(`SELECT instance_id FROM ${s}.routes WHERE id = $1`, [route.id])
    ).rows[0] as { instance_id: string | null } | undefined
    const instanceId = instanceRow?.instance_id && instanceRow.instance_id !== '' ? instanceRow.instance_id : null

    let engineStatus: string | null = null
    if (instanceId !== null) {
      const statusRow = (await pool.query('SELECT df.status($1) AS status', [instanceId]).catch(() => undefined))?.rows[0] as
        | { status?: string }
        | undefined
      engineStatus = statusRow?.status ?? null
    }

    const parkedKind = route.current_node !== null ? kindByRouteNode.get(`${route.id} ${route.current_node}`) ?? null : null
    const ageHours = (nowMs - Date.parse(route.updated_at)) / 3_600_000

    const { reapable, classification } = classifyRoute({ engineStatus, parkedKind, ageHours, staleHours })
    candidates.push({
      routeId: route.id,
      quest: route.quest,
      routeStatus: route.status,
      currentNode: route.current_node,
      parkedKind,
      instanceId,
      engineStatus,
      updatedAt: route.updated_at,
      ageHours,
      reapable,
      classification,
    })
  }
  return candidates
}

export interface ClassifyRouteInput {
  /** pg_durable engine status (df.status): running | pending | terminal | null. */
  readonly engineStatus: string | null
  /** Task kind of the node the route is parked on. */
  readonly parkedKind: WaypointFolderTaskKind | null
  readonly ageHours: number
  readonly staleHours: number
}

/**
 * The whole safety policy of reaping, as one pure function.
 *
 * The burden is on KEEPING, not reaping: an abandoned run can be stuck in more
 * than one shape — parked on a recipe wait (advanced, then the bridge died,
 * Alma's case), or never advanced at all (engine 'pending', no current node,
 * because no bridge ever picked it up). Enumerating the reapable shapes misses
 * one; enumerating the PROTECTED ones does not. So a genuinely-parked engine
 * (running/pending) that is stale past the threshold is reapable UNLESS it is
 * one of the self-resolving waits — a gate (awaiting a human), or a
 * wait/timer/delay (fires in-database). Those are never reaped by age however
 * stale, because they can still resolve without a bridge. Freshness is the
 * other guard: a just-started or mid-dispatch route has not been abandoned yet.
 */
export function classifyRoute(input: ClassifyRouteInput): { reapable: boolean; classification: string } {
  const { engineStatus, parkedKind, ageHours, staleHours } = input
  const age = `${ageHours.toFixed(1)}h`

  if (engineStatus === null) {
    return { reapable: false, classification: 'no engine instance — never started durably' }
  }
  if (engineStatus !== 'running' && engineStatus !== 'pending') {
    // Engine already terminal but the route row says active/blocked — a
    // different leak (status not synced back). Surface it; cancel won't help.
    return { reapable: false, classification: `engine already ${engineStatus} — route row is stale (needs status sync, not a reap)` }
  }
  if (parkedKind !== null && SELF_RESOLVING_PARK_KINDS.has(parkedKind)) {
    return { reapable: false, classification: `legitimately parked at a ${parkedKind} — resolves without a bridge, never reaped by age` }
  }
  if (ageHours < staleHours) {
    return { reapable: false, classification: `parked on ${parkedKind ?? 'no node'} but fresh (${age} < ${staleHours}h) — may be starting or mid-dispatch; kept` }
  }
  const where = parkedKind === null ? 'never advanced to a node' : `parked on a ${parkedKind} wait`
  return { reapable: true, classification: `abandoned: ${where} for ${age} (>= ${staleHours}h) with no bridge progressing it` }
}

export interface ReapResult {
  readonly routeId: string
  readonly ok: boolean
  readonly error?: string
}

/**
 * Cancel every reapable candidate through the sanctioned per-route cancel
 * (df.cancel of the engine instance, then route status + event). A candidate
 * that is not reapable is skipped. Failures are collected, not thrown, so one
 * stuck instance does not block reaping the rest.
 */
export async function reapAbandonedRoutes(
  projectRoot: string,
  candidates: readonly RouteReapCandidate[],
  reason: string,
): Promise<ReapResult[]> {
  const results: ReapResult[] = []
  for (const candidate of candidates) {
    if (!candidate.reapable) continue
    try {
      await cancelWaypointRoute(projectRoot, { routeId: candidate.routeId, reason })
      results.push({ routeId: candidate.routeId, ok: true })
    } catch (error) {
      results.push({ routeId: candidate.routeId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
