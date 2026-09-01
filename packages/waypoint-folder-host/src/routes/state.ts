import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize } from 'node:path'

import { appendRouteEvent } from '../events/jsonl.ts'
import { isDurablePostgresRouteBackend } from '../project/backend.ts'
import { registerBridgeProject } from '../pgdurable/bridge-registry.ts'
// ../pgdurable/bridge.ts is loaded LAZILY: an eager import here drags the
// bridge's whole module graph — legal/acquisition/store.ts's TS parameter
// property included — onto every module that touches route state (questions,
// reconcile, the adoption tools), and Node's strip-only mode refuses that
// syntax, killing src-spawned deterministic steps
// (docs/ERRORS-AND-FIXES.md, 2026-08-25). All call sites are async.
const bridgeModule = () => import('../pgdurable/bridge.ts')
import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'

import { computeChangesetDigest, gateApprovesChangeset, gatedArtifactPaths } from './changeset.ts'
import { getWaypointRoute, updateWaypointRoute } from './store.ts'

import type { ChangesetDigest } from './changeset.ts'
import type { RetryDurableTaskResult } from '../pgdurable/bridge.ts'
/** Actor marker a reconcile-style caller stamps when it retires a confirmation gate as already answered. */
const GATE_MOOT_ACTOR = 'system-reconcile'
import type { WaypointFolderTask } from '../tasks/types.ts'
import type { WaypointFolderRoute, WaypointFolderRouteStatus } from './types.ts'

export interface RouteGateDecisionInput {
  readonly routeId: string
  readonly node: string
  readonly note?: string
  readonly nextNode?: string
  /** Required when the gate declares `approves: changeset`: the digest the
   * reviewer was shown. Recomputed server-side at decision time; a mismatch
   * refuses the approval (TOCTOU close — the bytes moved mid-review). */
  readonly changesetDigest?: string
  readonly now?: Date
}

export interface PauseWaypointRouteInput {
  readonly routeId: string
  readonly reason?: string
  readonly now?: Date
}

export interface ResumeWaypointRouteInput {
  readonly routeId: string
  readonly now?: Date
}

export interface ResolveWaypointRouteBlockerInput {
  readonly routeId: string
  readonly note?: string
  readonly now?: Date
}

/**
 * What the attorney reads in the activity log for a gate decision.
 *
 * Prefers the gate's human-authored quest title. With none, deslugs the node
 * — readable, and never a bare identifier next to a route number.
 */
export function gateDecisionActivityTitle(
  decision: 'approved' | 'rejected',
  node: string,
  taskTitle: string | null,
): string {
  const ask = taskTitle?.trim() ? taskTitle.trim() : node.replace(/[-_]+/g, ' ').trim()
  return `${decision === 'approved' ? 'Approved' : 'Declined'}: ${ask}`
}

/** The gate task's title, or null when it cannot be looked up. */
async function gateTaskTitle(projectRoot: string, input: RouteGateDecisionInput): Promise<string | null> {
  try {
    const tasks = await listWaypointTasks(projectRoot)
    const gate = tasks.find(
      (task) => task.route_id === input.routeId && task.plan_ref === input.node && task.kind === 'gate',
    )
    return gate?.title ?? null
  } catch {
    // Narration must never fail the decision it records.
    return null
  }
}

export async function approveRouteGate(projectRoot: string, input: RouteGateDecisionInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    return decideDurableRouteGate(projectRoot, input, 'approve')
  }

  await assertDecidesCurrentGate(projectRoot, route, input.node)
  const previousNode = route.current_node
  const nextNode = input.nextNode ?? route.current_node
  // Lineage-derived gate status (the contract fix adopted from beads before it
  // exited): an approved gate happened, so its task records 'done' — matching
  // the durable engine — instead of staying parked at 'blocked'.
  const tasks = await listWaypointTasks(projectRoot)
  const gateTask = tasks.find(
    (task) => task.route_id === route.id && task.plan_ref === route.current_node && task.kind === 'gate',
  )
  const changeset = gateTask ? await verifyChangesetApproval(projectRoot, tasks, gateTask, input) : null
  if (gateTask) {
    await updateWaypointTask(projectRoot, gateTask.id, { status: 'done', updated_at: timestampFor(input.now) })
  }
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    current_node: nextNode,
    updated_at: timestampFor(input.now),
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.gate.approved',
    now: input.now,
    payload: {
      node: input.node,
      previous_node: previousNode,
      next_node: nextNode,
      ...(input.note ? { note: input.note } : {}),
      ...(changeset ? { changeset } : {}),
    },
  })
  return updated
}

export interface MootRouteGateInput {
  readonly routeId: string
  readonly node: string
  /** The satisfied landmarks that make the gate's question already answered. */
  readonly satisfiedBy: readonly string[]
  readonly now?: Date
}

/**
 * Retire a CONFIRMATION gate whose question the case has already answered
 * (Aaron 2026-08-18).
 *
 * This is not an approval and must never read as one. The operator answered
 * "the PIP application went out on the 9th"; that answer was recorded as a
 * case fact, the fact satisfied `pip_application_filed`, and this gate is now
 * asking a question with a written answer sitting next to it. Waypoint is not
 * deciding anything — it is observing that the decision already exists, the
 * same way the sweep releases a landmark wait without a human retyping it.
 *
 * The guardrail is the caller's: only `isConfirmationGate` kinds reach here,
 * and a changeset gate is refused outright, because "approve these bytes" is
 * never a question a landmark can answer.
 *
 * On the wire the engine only understands approve-or-fail — a compiled graph
 * marks the task `failed` for any decision that is not the literal string
 * `approve` — so the signal says approve and carries `actor:
 * system-reconcile` to say who and why. Graphs compiled from 2026-08-18
 * read that marker and record `route.gate.moot`; graphs compiled before it
 * record `route.gate.approved` with the marker in the payload. Either way we
 * append our own `route.gate.moot` event FIRST, so the log states what
 * happened even on a run that started under the old graph.
 */
export async function mootRouteGate(projectRoot: string, input: MootRouteGateInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
  await assertDecidesCurrentGate(projectRoot, route, input.node)
  const node = route.current_node as string

  const tasks = await listWaypointTasks(projectRoot)
  const gateTask = tasks.find((t) => t.route_id === route.id && t.plan_ref === node && t.kind === 'gate')
  if (gateTask && gateApprovesChangeset(gateTask)) {
    throw new Error(
      `gate ${node} on run ${route.id} approves a changeset — a satisfied landmark cannot stand in for reviewing the bytes`,
    )
  }

  const payload = {
    node,
    actor: GATE_MOOT_ACTOR,
    satisfied_by: [...input.satisfiedBy],
    reason: `the case already records ${input.satisfiedBy.join(' and ')}`,
  }
  await appendRouteEvent(projectRoot, route.id, { kind: 'route.gate.moot', now: input.now, payload })

  if (!(await isDurablePostgresRouteBackend(projectRoot))) {
    if (gateTask) {
      await updateWaypointTask(projectRoot, gateTask.id, { status: 'done', updated_at: timestampFor(input.now) })
    }
    return updateWaypointRoute(projectRoot, route.id, {
      status: 'active',
      current_node: node,
      updated_at: timestampFor(input.now),
    })
  }

  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const instanceResult = await pool.query(`SELECT instance_id FROM ${s}.routes WHERE id = $1`, [route.id])
  const instanceId = (instanceResult.rows[0] as { instance_id: string | null } | undefined)?.instance_id
  if (typeof instanceId !== 'string' || instanceId === '') {
    throw new Error(`Run ${route.id} has no engine instance id — was it started with backend.postgres.durable: true?`)
  }
  if ((await (await bridgeModule()).durableSignalNodeStatus(pool, instanceId, `gate:${node}`)) === 'completed') {
    throw new Error(`Gate ${node} on run ${route.id} was already decided — the engine is advancing past it.`)
  }
  const consumed = await (await bridgeModule()).signalDurableInstance(pool, instanceId, `gate:${node}`, {
    decision: 'approve',
    actor: GATE_MOOT_ACTOR,
    satisfied_by: [...input.satisfiedBy],
  })
  if (!consumed) {
    throw new Error(`gate moot signal was not consumed — is run ${route.id} parked at gate ${node}?`)
  }
  await waitForDurableTaskStatus(pool, schema, route.id, node, 'done')
  await registerBridgeProject(projectRoot)
  return requireRoute(projectRoot, route.id)
}

export interface GateChangesetPresentation {
  readonly routeId: string
  readonly node: string
  readonly approves: 'changeset' | 'completion'
  readonly changeset: ChangesetDigest | null
}

/**
 * What a reviewer of this gate is looking at: the gate mode and, on a
 * changeset gate, the digest + per-file manifest computed over the gated
 * artifact set as it exists right now. The UI shows this digest and sends it
 * back with the approval (read-verify-bind, design §4).
 */
export async function presentGateChangeset(
  projectRoot: string,
  routeId: string,
  node: string,
): Promise<GateChangesetPresentation> {
  const route = await requireRoute(projectRoot, routeId)
  const tasks = await listWaypointTasks(projectRoot)
  const gateTask = tasks.find(
    (t) => t.route_id === route.id && (t.plan_ref === node || t.id === node) && t.kind === 'gate',
  )
  if (!gateTask) throw new Error(`No gate task at node "${node}" on run ${route.id}`)
  if (!gateApprovesChangeset(gateTask)) {
    return { routeId: route.id, node: gateTask.plan_ref, approves: 'completion', changeset: null }
  }
  const changeset = await computeChangesetDigest(projectRoot, gatedArtifactPaths(tasks, gateTask))
  return { routeId: route.id, node: gateTask.plan_ref, approves: 'changeset', changeset }
}

/**
 * Changeset-gate enforcement (docs/designs/changeset-gate-mode.md §4): on a
 * gate declaring `approves: changeset`, an approval must carry the digest the
 * reviewer was shown; we recompute over the gated artifact set NOW and refuse
 * on mismatch — the bytes changed while the human was reviewing. Returns the
 * verified binding to record, or null on a completion-mode gate (today's
 * semantics, untouched).
 */
async function verifyChangesetApproval(
  projectRoot: string,
  tasks: readonly WaypointFolderTask[],
  gateTask: WaypointFolderTask,
  input: RouteGateDecisionInput,
): Promise<ChangesetDigest | null> {
  if (!gateApprovesChangeset(gateTask)) return null
  const current = await computeChangesetDigest(projectRoot, gatedArtifactPaths(tasks, gateTask))
  if (!input.changesetDigest) {
    throw new Error(
      `gate ${gateTask.plan_ref} approves a changeset: pass --changeset-digest with the digest presented to the reviewer (current: ${current.digest})`,
    )
  }
  if (input.changesetDigest !== current.digest) {
    throw new Error(
      `stale changeset: the reviewed digest ${input.changesetDigest} no longer matches the gated artifacts (current: ${current.digest}) — the bytes changed during review; re-review and re-approve`,
    )
  }
  return current
}

export async function rejectRouteGate(projectRoot: string, input: RouteGateDecisionInput): Promise<WaypointFolderRoute> {
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    return decideDurableRouteGate(projectRoot, input, 'reject')
  }

  const route = await requireRoute(projectRoot, input.routeId)
  await assertDecidesCurrentGate(projectRoot, route, input.node)
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'blocked',
    current_node: input.node,
    updated_at: timestampFor(input.now),
  })

  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.gate.rejected',
    now: input.now,
    payload: {
      node: input.node,
      previous_node: route.current_node,
      ...(input.note ? { note: input.note } : {}),
    },
  })
  return updated
}

/**
 * Gate decisions on a durable run (P2/B4). The signal contract: only an
 * APPROVE touches the engine — it is delivered with the confirm-consumption
 * protocol (a signal sent before the wait parks is dropped) and the engine
 * records done + the approved event before we return. A REJECT is recorded
 * off-graph exactly like the P1 folder path (route stays blocked at the
 * gate + 'route.gate.rejected' event) and the engine's wait stays parked,
 * so the gate remains decidable — in-graph re-decide loops are unusable
 * because df.loop iterations re-execute the whole graph (ContinuedAsNew,
 * executed finding 2026-07-12). Both paths run the current-gate guard.
 */
async function decideDurableRouteGate(
  projectRoot: string,
  input: RouteGateDecisionInput,
  decision: 'approve' | 'reject',
): Promise<WaypointFolderRoute> {
  if (input.nextNode !== undefined) {
    throw new Error('--next-node does not apply to a durable run: the engine advances the run by its compiled graph')
  }
  const route = await requireRoute(projectRoot, input.routeId)
  await assertDecidesCurrentGate(projectRoot, route, input.node)
  // input.node may be the task-id alias; the plan_ref is route.current_node
  // (the guard proved it).
  const node = route.current_node as string

  if (decision === 'reject') {
    const updated = await updateWaypointRoute(projectRoot, route.id, {
      status: 'blocked',
      current_node: node,
      updated_at: timestampFor(input.now),
    })
    await appendRouteEvent(projectRoot, route.id, {
      kind: 'route.gate.rejected',
      now: input.now,
      payload: {
        node,
        previous_node: route.current_node,
        ...(input.note ? { note: input.note } : {}),
      },
    })
    return updated
  }

  // Changeset-gate enforcement runs BEFORE the engine signal: the binding
  // rides the signal data, which the compiled graph records verbatim into
  // the gate task's evidence and the route.gate.approved event payload —
  // no graph change, existing durable runs stay valid.
  const tasks = await listWaypointTasks(projectRoot)
  const gateTask = tasks.find((t) => t.route_id === route.id && t.plan_ref === node && t.kind === 'gate')
  const changeset = gateTask ? await verifyChangesetApproval(projectRoot, tasks, gateTask, input) : null

  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const instanceResult = await pool.query(`SELECT instance_id FROM ${s}.routes WHERE id = $1`, [route.id])
  const instanceId = (instanceResult.rows[0] as { instance_id: string | null } | undefined)?.instance_id
  if (typeof instanceId !== 'string' || instanceId === '') {
    throw new Error(`Run ${route.id} has no engine instance id — was it started with backend.postgres.durable: true?`)
  }
  // Stale-read guard (executed finding, B5 2026-07-12): after an approve the
  // route row keeps reading blocked-at-this-gate for a moment (the engine's
  // route-active update runs two nodes after the wait), so a fast second
  // approve passes the current-gate guard — and then hangs the full confirm
  // window against a wait that is already consumed. The engine is the truth:
  // refuse decided gates immediately.
  if ((await (await bridgeModule()).durableSignalNodeStatus(pool, instanceId, `gate:${node}`)) === 'completed') {
    throw new Error(`Gate ${node} on run ${route.id} was already decided — the engine is advancing past it; re-check "waypoint route" in a moment.`)
  }
  const consumed = await (await bridgeModule()).signalDurableInstance(pool, instanceId, `gate:${node}`, {
    decision,
    ...(input.note ? { note: input.note } : {}),
    ...(changeset ? { changeset } : {}),
  })
  if (!consumed) {
    throw new Error(`gate decision signal was not consumed — is run ${route.id} parked at gate ${node}?`)
  }
  await waitForDurableTaskStatus(pool, schema, route.id, node, 'done')
  // A1: the engine advances past the gate and mints the next dispatch —
  // touch the bridge registry so a parked bridge gets respawned to run it.
  await registerBridgeProject(projectRoot)
  return requireRoute(projectRoot, route.id)
}

/** Wait for the engine to record a decision on the gate task (it is the writer). */
async function waitForDurableTaskStatus(
  pool: Awaited<ReturnType<typeof getWaypointPostgres>>['pool'],
  schema: string,
  routeId: string,
  planRef: string,
  expected: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: string | undefined
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT status FROM ${quoteIdent(schema)}.tasks WHERE route_id = $1 AND plan_ref = $2`,
      [routeId, planRef],
    )
    last = (result.rows[0] as { status?: string } | undefined)?.status
    if (last === expected) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `gate decision signalled but the engine did not record '${expected}' on ${planRef} within ${timeoutMs}ms (last status: ${last ?? 'unknown'})`,
  )
}

/**
 * Pause on a durable run keeps the P1 status-overlay behavior (B4 decision):
 * the engine has no pause primitive (df.cancel is terminal, not resumable),
 * and a durable run only moves when something signals it — dispatch
 * completions and gate decisions both go through operator-driven commands.
 * The route-row status is an operator annotation; the engine's next recorded
 * outcome may overwrite it.
 *
 * Resume is no longer symmetrical: an overlay is enough to undo a pause, but
 * not to undo a failure. See `resumeWaypointRoute`.
 */
export async function pauseWaypointRoute(projectRoot: string, input: PauseWaypointRouteInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'blocked',
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.paused',
    now: input.now,
    payload: {
      previous_status: route.status,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  })
  return updated
}

/**
 * Resuming a run that FAILED needs a dispatch, not a label.
 *
 * A durable run only moves when something signals it, so setting the route
 * row back to 'active' after a failure leaves the run reading as running
 * with nothing behind it — permanently. Three records requests sat that way
 * for a day after a revoked worker token (2026-07-26): task failed, route
 * resumed, no dispatch, no way to notice from the Console. The revoked-token
 * case is the one resume was BUILT for, so it is the one it must actually
 * carry: re-dispatch the failed node the way `tasks retry` does.
 *
 * Null when the run did not stop on a failed node — a paused run resumes on
 * the status alone, which is all it ever needed.
 *
 * Keyed on the failed TASK, not on `current_node`: that field holds the node
 * on a quest route but the phase slug on an adhoc one, so matching it against
 * plan_ref silently found nothing half the time.
 */
async function redispatchFailedNode(
  projectRoot: string,
  route: WaypointFolderRoute,
): Promise<RetryDurableTaskResult | null> {
  const tasks = await listWaypointTasks(projectRoot)
  const failed = tasks.filter((t) => t.route_id === route.id && t.status === 'failed')
  if (failed.length === 0) return null
  const task =
    failed.length === 1 ? failed[0] : failed.find((t) => t.plan_ref === route.current_node)
  if (!task) {
    // Ambiguous: which attempt did the operator mean? Naming them beats
    // picking one, and `tasks retry --task-id` is the precise instrument.
    throw new Error(
      `Run ${route.id} has ${failed.length} failed nodes (${failed.map((t) => t.plan_ref).join(', ')}) — ` +
        `retry the one you mean with \`waypoint tasks retry --task-id <id>\``,
    )
  }
  return (await bridgeModule()).retryDurableWaypointTask(projectRoot, task.id)
}

export async function resumeWaypointRoute(projectRoot: string, input: ResumeWaypointRouteInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
  // Fails loud when the failed node cannot be re-dispatched (no recipe, no
  // engine instance): "this run cannot be resumed" is the truth, and beats
  // handing back an 'active' run that will never move again.
  const retried = (await isDurablePostgresRouteBackend(projectRoot))
    ? await redispatchFailedNode(projectRoot, route)
    : null
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.resumed',
    now: input.now,
    payload: {
      previous_status: route.status,
      ...(retried ? { retried_node: retried.task_ref, dispatch_id: retried.dispatch_id } : {}),
    },
  })
  return updated
}

export interface CancelWaypointRouteInput {
  readonly routeId: string
  readonly reason?: string
  readonly now?: Date
}

/**
 * X6 (closing the X4 gap): the operator surface for stopping a route — the
 * only way to end a repeating quest, and the sanctioned alternative to raw
 * psql df.cancel. On the durable backend the ENGINE instance is cancelled
 * FIRST (a route marked cancelled must actually stop moving — the status
 * overlay alone would lie while the engine kept executing); then the route
 * row and event record the cancellation. Terminal routes refuse. df.cancel
 * failures propagate (fail closed): if the engine cannot be stopped, the
 * route is not recorded as stopped.
 */
export async function cancelWaypointRoute(projectRoot: string, input: CancelWaypointRouteInput): Promise<WaypointFolderRoute> {
  const route = await requireRoute(projectRoot, input.routeId)
  if (route.status === 'complete' || route.status === 'cancelled') {
    throw new Error(`Run ${route.id} is already ${route.status}`)
  }

  if (await isDurablePostgresRouteBackend(projectRoot)) {
    const { pool, schema } = await getWaypointPostgres(projectRoot)
    const instanceResult = await pool.query(`SELECT instance_id FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [route.id])
    const instanceId = (instanceResult.rows[0] as { instance_id: string | null } | undefined)?.instance_id
    if (typeof instanceId === 'string' && instanceId !== '') {
      const statusResult = await pool.query('SELECT df.status($1) AS status', [instanceId])
      const engineStatus = (statusResult.rows[0] as { status?: string } | undefined)?.status
      if (engineStatus === 'running' || engineStatus === 'pending') {
        await pool.query('SELECT df.cancel($1, $2)', [instanceId, input.reason ?? `Run ${route.id} cancelled by operator`])
      }
    }
  }

  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'cancelled',
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.cancelled',
    now: input.now,
    payload: {
      previous_status: route.status,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  })
  return updated
}

export async function resolveWaypointRouteBlocker(
  projectRoot: string,
  input: ResolveWaypointRouteBlockerInput,
): Promise<WaypointFolderRoute> {
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    // X3: a durable route parked at a WAIT is resolved with the wait signal —
    // the landmark was observed, so the deadline race's signal arm wins and
    // the engine records task.wait.resolved (the same command resolves waits
    // on the folder backend). Everything else keeps the retry
    // guidance: a blocked recipe task is a parked retry loop, and its
    // resolution arrives as a fresh dispatch whose bridge completion signals
    // the wait. No status reset applies on this backend — the engine writes.
    const route = await requireRoute(projectRoot, input.routeId)
    // Identify the wait by engine truth (current_node + the task's authored
    // kind), NOT by the task row's blocked status: the engine writes the
    // routes row blocked one node before the task row (executed finding, X3),
    // so a resolve issued in that window would miss a status-based lookup.
    // The confirmed-signal loop below already tolerates signalling slightly
    // before the wait registers (re-send until consumed, B4.5).
    const tasks = await listWaypointTasks(projectRoot)
    const waitTask =
      route.current_node === null
        ? undefined
        : tasks.find(
            (task) =>
              task.route_id === route.id && task.plan_ref === route.current_node && task.kind === 'wait' && task.status !== 'done',
          )
    if (waitTask === undefined) {
      throw new Error(
        'On a durable run, resolve a blocked task with "waypoint tasks retry --task-id <id>" — the bridge re-runs it and its outcome signal resumes the run.',
      )
    }
    const node = waitTask.plan_ref
    const { pool, schema } = await getWaypointPostgres(projectRoot)
    const instanceResult = await pool.query(`SELECT instance_id FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [route.id])
    const instanceId = (instanceResult.rows[0] as { instance_id: string | null } | undefined)?.instance_id
    if (typeof instanceId !== 'string' || instanceId === '') {
      throw new Error(`Run ${route.id} has no engine instance id — was it started with backend.postgres.durable: true?`)
    }
    // Stale-read guard, same shape as gates (B5): the engine is the truth —
    // refuse waits it has already ended.
    if ((await (await bridgeModule()).durableSignalNodeStatus(pool, instanceId, `wait:${node}`)) === 'completed') {
      throw new Error(`Wait ${node} on run ${route.id} already ended — the engine is advancing past it; re-check "waypoint route" in a moment.`)
    }
    const consumed = await (await bridgeModule()).signalDurableInstance(pool, instanceId, `wait:${node}`, {
      observed: true,
      ...(input.note ? { note: input.note } : {}),
    })
    if (!consumed) {
      throw new Error(`wait resolution signal was not consumed — is run ${route.id} parked at wait ${node}?`)
    }
    await waitForDurableTaskStatus(pool, schema, route.id, node, 'done')
    // A1: same as a gate approve — work follows; touch the bridge registry.
    await registerBridgeProject(projectRoot)
    return requireRoute(projectRoot, route.id)
  }

  const route = await requireRoute(projectRoot, input.routeId)
  const blockedTask = await currentBlockedTask(projectRoot, route)
  if (!blockedTask) throw new Error(`No blocked task found for route ${route.id}`)
  const missingArtifacts = await missingOutputArtifacts(projectRoot, blockedTask)
  if (missingArtifacts.length > 0) {
    throw new Error(`Missing required artifacts for ${blockedTask.plan_ref}: ${missingArtifacts.join(', ')}`)
  }

  const runner = isRecord(blockedTask.metadata?.runner) ? blockedTask.metadata.runner : {}
  const { missing_artifacts: _missingArtifacts, block_reason: _blockReason, ...cleanWaypoint } = runner
  await updateWaypointTask(projectRoot, blockedTask.id, {
    status: 'open',
    updated_at: timestampFor(input.now),
    metadata: { ...(blockedTask.metadata ?? {}), runner: cleanWaypoint },
  })
  const updated = await updateWaypointRoute(projectRoot, route.id, {
    status: 'active',
    current_node: blockedTask.plan_ref,
    updated_at: timestampFor(input.now),
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.blocker.resolved',
    now: input.now,
    payload: {
      task_id: blockedTask.id,
      node: blockedTask.plan_ref,
      previous_status: route.status,
      ...(input.note ? { note: input.note } : {}),
    },
  })
  return updated
}

async function requireRoute(projectRoot: string, routeId: string): Promise<WaypointFolderRoute> {
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)
  return route
}

/**
 * The engine is the source of truth for gate decisions: the decision must target
 * the route's CURRENT node. A stale render, a replayed command, or a non-UI caller
 * must not decide a non-current gate (which would unblock the live route or block at
 * the wrong node). We validate against route.current_node — which startRoute sets and
 * gate transitions advance — independent of whether the gate task has reached
 * 'blocked' status yet (a gate can be decided while the route is still active).
 */
async function assertDecidesCurrentGate(
  projectRoot: string,
  route: WaypointFolderRoute,
  node: string,
): Promise<void> {
  // No current node → route was never started; do not allow a gate decision to be written.
  if (route.current_node == null) {
    throw new Error(`gate.decide: route ${route.id} has no current gate to decide`)
  }
  // Fast path: node matches current_node directly.
  if (node === route.current_node) return
  // Accept the id of the task sitting at current_node as an alternate identity.
  const tasks = await listWaypointTasks(projectRoot)
  const currentTask = tasks.find((t) => t.route_id === route.id && t.plan_ref === route.current_node)
  if (currentTask && node === currentTask.id) return
  throw new Error(`gate.decide: node "${node}" is not the current gate of route ${route.id}`)
}

async function currentBlockedTask(projectRoot: string, route: WaypointFolderRoute): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointTasks(projectRoot)
  return tasks.find((task) => task.route_id === route.id && task.status === 'blocked' && task.plan_ref === route.current_node) ??
    tasks.find((task) => task.route_id === route.id && task.status === 'blocked') ??
    null
}

async function missingOutputArtifacts(projectRoot: string, task: WaypointFolderTask): Promise<string[]> {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const artifacts = Array.isArray(runner.output_artifacts)
    ? runner.output_artifacts.flatMap((artifact): string[] => {
        if (typeof artifact === 'string' && artifact.trim().length > 0) return [artifact]
        if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.trim().length > 0) return [artifact.path]
        return []
      })
    : []
  const missing: string[] = []
  for (const artifact of artifacts) {
    const safePath = safeRelativeArtifactPath(artifact)
    if (!safePath) {
      missing.push(artifact)
      continue
    }
    try {
      await stat(join(projectRoot, safePath))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(artifact)
        continue
      }
      throw error
    }
  }
  return missing
}

function safeRelativeArtifactPath(artifact: string): string | null {
  const normalized = normalize(artifact.trim())
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) return null
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}
