import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'

import { createRecipeRuntime, createRecipeRuntimeLanes, loadRecipeManifest } from '../autopilot/run.ts'
import { writeWaypointRunDossier } from '../reports/run-dossier.ts'
import { maskEvidencePayload } from '../runtime/credential-mask.ts'
import { appendRouteEvent } from '../events/jsonl.ts'
import { registerBridgeProject } from './bridge-registry.ts'
import { resolvePostgresBackend } from '../project/backend.ts'
import { dispatchChannelName, getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { accountRefusal } from './lane-health.ts'
import { laneBrainHold, readBrainReserve } from './brain-reserve.ts'
import { readWaypointProjectConfig } from '../project/config.ts'
import { updateWaypointRoute } from '../routes/store.ts'
import { DeterministicRecipeRuntime } from '../runtime/deterministic-runtime.ts'
import { cordisRecipeRuntimeFor } from '../runtime/cordis-runtime-for.ts'
import { CORDIS_INFRA_REFUSAL_PREFIX } from '../runtime/cordis-jailed-runtime.ts'
import { createPgOauthLaneLocks } from '../sandbox/oauth-lane-lock.ts'
import { createCordisLanePicker } from '../sandbox/oauth-lane-resolve.ts'
import { piRecipeRuntimeFor } from '../runtime/pi-runtime-for.ts'
import { NullRecipeRuntime, UnconfiguredRecipeRuntime } from '../runtime/null-runtime.ts'
import { updateWaypointTask } from '../tasks/store.ts'
import type { RecipeRuntimePriorAttempt } from '../runtime/work-order.ts'

/**
 * Build the deterministic runtime for a project (B2): it needs only the
 * project's named roots (the Seatbelt jail base) and the worker budget. Cheap
 * to build; deterministic dispatches are rare (one assemble step per run).
 */
async function deterministicRuntimeFor(projectRoot: string): Promise<DeterministicRecipeRuntime> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return new DeterministicRecipeRuntime({
      ...(config.roots ? { roots: config.roots } : {}),
      ...(config.runtime.worker?.task_timeout_minutes
        ? { timeoutMs: config.runtime.worker.task_timeout_minutes * 60_000 }
        : {}),
    })
  } catch {
    return new DeterministicRecipeRuntime()
  }
}

/**
 * The dispatch bridge (P2/B3-B4, docs/designs/p2-waypoint-on-pgdurable.md):
 * closes the loop between the pg_durable engine and the recipe runtimes. The
 * compiled graph inserts a `waypoint.dispatches` row and parks on
 * `wait_for_signal('task:<ref>')`; the bridge claims the row, runs the
 * project's configured recipe runtime (null/local/worker — the same seam the
 * autopilot uses), and reports the outcome. The Console daemon absorbs this
 * loop when the worker host lands (P3).
 *
 * Signal contract (B4): the compiled graph is the HAPPY PATH — the bridge
 * signals the engine only when an attempt FINISHES. Failed / exhausted /
 * stopped attempts are recorded off-graph through the store seam (task
 * status + evidence, route status, an event) while the engine's wait stays
 * parked; `waypoint tasks retry` dispatches the next attempt and its finished
 * outcome resumes the graph. This is forced by two executed findings:
 * a signal sent before the wait parks is DROPPED (2026-07-11), and df.loop
 * iterations are ContinuedAsNew — they re-execute the whole graph from
 * fresh history (2026-07-12), so in-graph retry loops are unusable.
 */

export interface WaypointBridgeRecipeRuntimeInput {
  readonly routeId: string
  readonly taskId: string
  readonly taskRef?: string
  readonly recipe: string
  readonly prompt: string
  readonly projectRoot: string
  readonly outputArtifacts?: readonly string[]
  readonly modelClass?: string
  /** The plan's `access:` map (rsc-8ip, {binding -> 'ro' | 'rw'}) — the
   * worker runtime's Seatbelt jail assembles its grants from it (P3/W2).
   * Absent = the plan declares no boundary; with the jail enabled that is a
   * fail-closed refusal to spawn. */
  readonly access?: Readonly<Record<string, string>>
  readonly priorAttempt?: RecipeRuntimePriorAttempt
  readonly signal?: AbortSignal
  /** For a deterministic recipe — its vetted host-step entrypoint name. Agent
   * runtimes ignore it; the deterministic runtime requires it. */
  readonly entrypoint?: string
}

export interface WaypointBridgeRecipeRuntime {
  runRecipe(input: WaypointBridgeRecipeRuntimeInput): Promise<{ readonly status: string }>
}

export interface WaypointBridgeProcessed {
  readonly dispatch_id: number
  readonly route_id: string
  readonly task_ref: string
  readonly recipe: string
  /** Normalized worker outcome. */
  readonly outcome: 'finished' | 'failed' | 'exhausted' | 'stopped'
  /**
   * The account refused, so the attempt was NOT recorded as a failure and the
   * dispatch went back on the queue for another lane (lane-health.ts). Carries
   * the provider's own sentence.
   */
  readonly account_refusal?: string
  /**
   * True when the engine advanced past the task: a finished outcome whose
   * signal was confirmed consumed. Non-finished outcomes are recorded
   * off-graph and never signalled, so this is false for them by design.
   */
  readonly engine_advanced: boolean
}

export interface RunWaypointBridgeOptions {
  /** Drain currently pending dispatches and return (dev/test mode). */
  readonly once?: boolean
  /** Daemon-mode fallback poll cadence; LISTEN/NOTIFY is the fast path. */
  readonly pollIntervalMs?: number
  /** How long to wait for a parked wait node before giving up on a signal. */
  readonly signalConfirmTimeoutMs?: number
  /**
   * Claim lease (B4.5): a 'running' dispatch whose claimed_at is older than
   * this is presumed orphaned by a dead bridge and reclaimed to 'pending' at
   * the start of each drain cycle. Live attempts heartbeat claimed_at at a
   * third of this cadence, so only a dead process's claims go stale.
   */
  readonly claimLeaseMs?: number
  /**
   * How many dispatches run at once (P3/W4). Default: the project config's
   * `runtime.worker.concurrency`, else 1 (sequential — the pre-W4 behavior).
   */
  readonly concurrency?: number
  /**
   * Park semantics (A1, docs/designs/a-autopilot-retirement.md): in daemon
   * mode, exit cleanly after this long with NO live work — no route in
   * 'active'/'blocked', no dispatch in 'pending'/'running', nothing in
   * flight. The Console's bridge supervisor treats a clean exit as PARK (no
   * respawn until the next trigger), mirroring the runner idle-exit +
   * rsc-bnq park split. Bridges must stay up while routes are live: timers
   * fire inside Postgres with no "next message" to relaunch on.
   */
  readonly idleExitMs?: number
  /** Injected runtime (tests); defaults to the project's configured runtime. */
  readonly runtime?: WaypointBridgeRecipeRuntime
  readonly signal?: AbortSignal
  readonly onEvent?: (event: string) => void
}

/**
 * A dispatch on this schema that ANOTHER bridge claimed while this one was up.
 *
 * More than one bridge legitimately serves a project — the Console's supervisor
 * registers its own the moment a route starts, so an operator who also runs
 * `waypoint bridge` by hand has two, and the atomic claim hands each row to
 * exactly one of them. Nothing is lost or double-run. What was lost is the
 * ACCOUNT: each bridge's log and its closing tally described only its own work,
 * so the operator-facing record of a twelve-dispatch run read as eleven, with
 * no hint that a twelfth existed. Reading one log, the missing row looks
 * exactly like a step that never ran.
 */
export interface WaypointBridgeElsewhere {
  readonly dispatch_id: number
  readonly route_id: string
  readonly task_ref: string
  readonly recipe: string
  readonly status: string
  /** The bridge that claimed it, named so two logs can be lined up. */
  readonly claimed_by: string
}

export interface RunWaypointBridgeResult {
  readonly processed: WaypointBridgeProcessed[]
  /**
   * Dispatches another bridge handled during this one's lifetime. Empty in the
   * ordinary single-bridge case; never omitted, so a reader never has to guess
   * whether the field is absent or the answer is none.
   */
  readonly elsewhere: WaypointBridgeElsewhere[]
}

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_SIGNAL_CONFIRM_TIMEOUT_MS = 60_000
const SIGNAL_POLL_MS = 500
const DEFAULT_CLAIM_LEASE_MS = 120_000

interface ClaimedDispatch {
  readonly id: number
  readonly route_id: string
  readonly task_ref: string
  readonly recipe: string
  readonly instance_id: string
}

export async function runWaypointBridge(projectRoot: string, options: RunWaypointBridgeOptions = {}): Promise<RunWaypointBridgeResult> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const runtime = options.runtime ?? (await createRecipeRuntime(projectRoot))
  const notify = options.onEvent ?? (() => {})
  const processed: WaypointBridgeProcessed[] = []
  // Claim ownership identity (W4): heartbeats are guarded on it, so this
  // bridge DETECTS when its lease was reclaimed and re-claimed elsewhere.
  const bridgeId = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`
  // The pool is either LANES (one subscription each) or N copies of the one
  // configured worker. A lane is a slot, so a pool of lanes ignores
  // `concurrency`: adding a subscription is how the pool grows.
  //
  // An EXPLICITLY injected runtime IS the pool (tests, ad-hoc drains) — the
  // contract recipeRuntimeLanesFor's docstring states and nothing enforced:
  // for a laneless project, createRecipeRuntimeLanes wraps the PROJECT
  // CONFIG's runtime into the synthetic lane, silently discarding the
  // injected one. Every bridge test that scripted a refusal, a failure, or a
  // lease-hold was actually exercising the project's `--simulated` runtime,
  // which finishes everything — the whole gated suite tested the wrong
  // runtime and rotted unseen (found 2026-08-08 chasing rsc-6js4).
  const injectedPool = options.runtime !== undefined ? [{ name: null, runtime }] : null
  let lanes = injectedPool ?? (await recipeRuntimeLanesFor(projectRoot, runtime))
  const concurrency =
    lanes.length > 1 ? lanes.length : Math.max(1, options.concurrency ?? (await configuredConcurrency(projectRoot)))
  const freeLanes = [...lanes]
  // A bridge parks for fifteen minutes and then lives for days, so the config
  // it read at startup goes stale under it. Raising `task_timeout_minutes`
  // from 30 to 180 changed nothing: the running bridge kept spawning workers
  // on the old 30-minute budget, and the same task died at exactly 30 minutes
  // twice (Aaron 2026-07-31). Config edits now take effect between dispatches.
  let configStamp = await configFingerprint(projectRoot)
  /** Lanes whose SUBSCRIPTION refused, and what it said. Cleared by a config
   *  edit (adding or fixing an account) — otherwise for this bridge's life. */
  const quarantined = new Map<string, string>()

  // The host pool (W4): up to `concurrency` dispatches in flight. With the
  // default of 1 the drain is exactly the pre-W4 sequential loop. A failure
  // inside a pooled attempt is captured and rethrown after the pool settles,
  // matching the sequential loop's propagation.
  const inFlight = new Set<Promise<void>>()
  let poolError: unknown
  // Q1 (docs/designs/q-quest-proving.md): an unconfigured runtime must never
  // take a dispatch to an outcome — not simulated, not a false failed
  // attempt. Leave recipe dispatches pending (visible work, keeps the bridge
  // unparked) and say so once per dispatch; gates, waits and timers still
  // advance through this bridge.
  const warnedUnconfigured = new Set<number>()
  let warnedAllQuarantined = false
  // Lanes held out because their ACCOUNT is serving Waypoint's brain
  // (brain-reserve.ts). Re-read per drain pass, so a picker switch or a
  // fallback in the Console releases/holds lanes with no restart. Notified
  // once per hold, again only after a release.
  const brainHoldNotified = new Set<string>()
  const schedule = (dispatch: ClaimedDispatch): void => {
    notify(`dispatch ${dispatch.id}: ${dispatch.task_ref} (${dispatch.recipe})`)
    const attempt: Promise<void> = processDispatch(pool, schema, projectRoot, runtime, dispatch, bridgeId, options)
      .then((result) => {
        processed.push(result)
        notify(`dispatch ${dispatch.id}: ${result.outcome}`)
      })
      .catch((error: unknown) => {
        poolError ??= error
      })
      .finally(() => {
        inFlight.delete(attempt)
      })
    inFlight.add(attempt)
  }
  const drain = async (): Promise<void> => {
    // Only while nothing is in flight: a running attempt keeps the runtime it
    // was spawned with, and a lane cannot be swapped underneath it.
    if (inFlight.size === 0) {
      const stamp = await configFingerprint(projectRoot)
      if (stamp !== configStamp) {
        configStamp = stamp
        lanes = injectedPool ?? (await recipeRuntimeLanesFor(projectRoot, runtime))
        // A config edit is how an operator adds or repairs an account, so it
        // is also how a quarantined lane gets another chance.
        quarantined.clear()
        freeLanes.length = 0
        freeLanes.push(...lanes)
        notify('.waypoint/config.yaml changed — the worker pool was rebuilt from it')
      }
    }
    const reclaimed = await reclaimStaleClaims(pool, schema, options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS)
    for (const id of reclaimed) notify(`dispatch ${id}: reclaimed from a stale claim (bridge died mid-attempt)`)
    for (const closed of await closeCancelledRouteDispatches(pool, schema)) {
      notify(`dispatch ${closed.id}: not run — ${closed.route_id} was cancelled`)
    }
    if (runtime instanceof UnconfiguredRecipeRuntime) {
      for (const id of await pendingDispatchIds(pool, schema)) {
        if (warnedUnconfigured.has(id)) continue
        warnedUnconfigured.add(id)
        notify(
          `dispatch ${id}: waiting for an agent, but runtime.recipe is not configured in .waypoint/config.yaml — ` +
            "configure `runtime.recipe: worker` with `runtime.worker.command`, or opt into simulation with `runtime.recipe: 'null'`",
        )
      }
      return
    }
    const brainReserve = await readBrainReserve()
    for (const lane of lanes) {
      const hold = lane.name === null ? null : laneBrainHold(lane.email, brainReserve)
      const key = lane.name ?? '(the configured worker)'
      if (hold !== null && !brainHoldNotified.has(key)) {
        brainHoldNotified.add(key)
        notify(`lane ${key} held out of the pool — ${hold}. It returns the moment Waypoint's brain switches accounts.`)
      } else if (hold === null && brainHoldNotified.delete(key)) {
        notify(`lane ${key} is back in the pool — Waypoint's brain no longer runs on its account.`)
      }
    }
    const brainHeld = (lane: { readonly name: string | null; readonly email?: string }): boolean =>
      lane.name !== null && laneBrainHold(lane.email, brainReserve) !== null
    for (;;) {
      if (options.signal?.aborted || poolError !== undefined) return
      // Every subscription refused: claiming again would hand the dispatch to
      // a lane that cannot serve it and re-queue it forever. Leave the work
      // pending, visible, and say so.
      if (lanes.length > 0 && quarantined.size >= lanes.length) {
        if (!warnedAllQuarantined) {
          warnedAllQuarantined = true
          notify(
            `every worker subscription is refusing work (${[...quarantined.entries()]
              .map(([name, why]) => `${name}: ${why}`)
              .join('; ')}) — dispatches stay queued until one is fixed in .waypoint/config.yaml`,
          )
        }
        return
      }
      while (inFlight.size >= concurrency) await Promise.race(inFlight)
      // With NAMED lanes configured, do not CLAIM work there is no lane to
      // run. The fallback below exists for a project with no lanes at all;
      // reaching it with lanes configured silently runs the default worker
      // command and credits the output to a lane that never ran it. Seen
      // live: the claude-max-1 lane refused with "Not logged in", its
      // dispatch went back on the queue, and the next claim ran it on the
      // default worker with no lane label — 27 encounter pages attributed to
      // a lane that was logged out the whole time. The all-quarantined guard
      // above does not close this: a re-queued dispatch can be claimed again
      // before the quarantine lands. Waiting is correct — the work is
      // durable and keeps.
      //
      // Named lanes only (rsc-6js4): a laneless project's pool holds one
      // synthetic null-named lane, and the finally below deliberately never
      // returns it (it is not a subscription to credit). Waiting on it here
      // starved the bridge after its FIRST dispatch — proven in vivo on the
      // auto-retry run, where three attempts of one task needed three
      // bridges. Laneless claiming is governed by `concurrency` alone; the
      // fallback mints the worker per claim.
      // "Free" is not "eligible": a lane held for Waypoint's brain sits in
      // freeLanes but takes no work. All-held behaves like all-busy — the
      // work is durable and keeps; the hold lifts when the registry changes.
      while (lanes.some((l) => l.name !== null) && !freeLanes.some((l) => !brainHeld(l))) {
        if (inFlight.size === 0) return
        await Promise.race(inFlight)
      }
      const dispatch = await claimNextDispatch(pool, schema, bridgeId)
      if (!dispatch) return
      const eligibleIndex = freeLanes.findIndex((l) => !brainHeld(l))
      const lane = eligibleIndex >= 0 ? freeLanes.splice(eligibleIndex, 1)[0] : { name: null, runtime }
      // Name the lane AND the account: when a subscription breaks, the log has
      // to say which one without anyone cross-referencing a config file.
      const laneLabel = lane.name ? ` [${lane.name}${lane.email ? ` ${lane.email}` : ''}]` : ''
      notify(`dispatch ${dispatch.id}: ${dispatch.task_ref} (${dispatch.recipe})${laneLabel}`)
      const attempt: Promise<void> = processDispatch(pool, schema, projectRoot, lane.runtime, dispatch, bridgeId, options)
        .then((result) => {
          processed.push(result)
          if (result.account_refusal !== undefined) {
            // The subscription refused, so the lane leaves the pool and the
            // dispatch is already back on the queue: the next free lane picks
            // the task up from where it left off. Eight subscriptions must not
            // be one subscription's billing cycle (Aaron 2026-08-02).
            quarantined.set(lane.name ?? '(the configured worker)', result.account_refusal)
            notify(
              `lane ${lane.name ?? '(the configured worker)'} is out of the pool — ${result.account_refusal}. ` +
                `dispatch ${dispatch.id} went back on the queue for another lane.`,
            )
            return
          }
          notify(`dispatch ${dispatch.id}: ${result.outcome}`)
        })
        .catch((error: unknown) => {
          poolError ??= error
        })
        .finally(() => {
          if (lane.name !== null && !quarantined.has(lane.name)) freeLanes.push(lane)
          inFlight.delete(attempt)
        })
      inFlight.add(attempt)
    }
  }
  const settle = async (): Promise<void> => {
    while (inFlight.size > 0) await Promise.race(inFlight)
    if (poolError !== undefined) throw poolError
  }

  // When this bridge came up. Everything claimed by someone else after this
  // instant is work that happened on this run's watch and is not in `processed`.
  const startedAt = new Date()

  await drain()
  if (options.once) {
    await settle()
    return { processed, elsewhere: await dispatchesHandledElsewhere(pool, schema, bridgeId, startedAt, notify) }
  }

  // Daemon mode: LISTEN for dispatch inserts, poll as a safety net, drain on
  // every wake-up until aborted.
  const resolved = await resolvePostgresBackend(projectRoot)
  const listener = new pg.Client({ connectionString: resolved.url })
  await listener.connect()
  try {
    let wake: (() => void) | null = null
    listener.on('notification', () => wake?.())
    await listener.query(`LISTEN ${quoteIdent(dispatchChannelName(schema))}`)
    notify(`listening on ${dispatchChannelName(schema)}`)

    let idleSince: number | null = null
    // rsc-9y6: routes whose dossier this bridge has already handled.
    const dossiersWritten = new Set<string>()
    while (!options.signal?.aborted) {
      await drain()
      // A rejected attempt poisons the pool: every later drain() returns at
      // its poolError guard without claiming. In --once mode settle() rethrows
      // and the run fails visibly; in daemon mode this loop used to keep
      // spinning FOREVER — alive, listening, sweeping, claiming nothing — a
      // zombie indistinguishable from an idle bridge (route-005, 2026-08-29:
      // 8 dispatches sat pending for 89 minutes under a live bridge). Exit
      // loudly instead: the work is durable, claims lease-reclaim, and the
      // Console's bridge manager starts a fresh bridge.
      if (poolError !== undefined) {
        notify(
          `a dispatch attempt crashed the pool — exiting so a fresh bridge takes over: ` +
            (poolError instanceof Error ? poolError.message : String(poolError)),
        )
        break
      }
      // After the drain, not inside it: the engine advances asynchronously, so a
      // route goes terminal AFTER the dispatch that finished it returns. This
      // tick sees what the last one could not.
      await sweepTerminalRouteDossiers(pool, schema, projectRoot, dossiersWritten, notify)
      if (options.idleExitMs !== undefined) {
        if (inFlight.size === 0 && !(await hasLiveWork(pool, schema))) {
          idleSince ??= Date.now()
          if (Date.now() - idleSince >= options.idleExitMs) {
            notify(`no live routes or dispatches for ${options.idleExitMs}ms — parking (clean exit)`)
            break
          }
        } else {
          idleSince = null
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve
        const timer = setTimeout(resolve, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
        void timer
      })
      wake = null
    }
  } finally {
    await listener.end()
  }
  await settle()
  return { processed, elsewhere: await dispatchesHandledElsewhere(pool, schema, bridgeId, startedAt, notify) }
}

/**
 * Dispatches on this schema that a DIFFERENT bridge claimed while this one ran.
 *
 * One query at exit, so the closing tally can account for the whole schema
 * rather than only for itself. A sibling bridge is normal (see
 * WaypointBridgeElsewhere) — the point is to say so out loud, because the failure
 * this closes is an operator reading one log and concluding a step never ran.
 *
 * Fails soft and SAYS SO: this runs after the work is done and must never turn
 * a good run into a bad exit. But a silent catch here would recreate the exact
 * defect it exists to fix, so an unreadable table is reported, not swallowed.
 */
export async function dispatchesHandledElsewhere(
  pool: pg.Pool,
  schema: string,
  bridgeId: string,
  since: Date,
  notify: (event: string) => void,
): Promise<WaypointBridgeElsewhere[]> {
  try {
    const { rows } = await pool.query<{
      id: string
      route_id: string
      task_ref: string
      recipe: string
      status: string
      claimed_by: string
    }>(
      `SELECT id, route_id, task_ref, recipe, status, claimed_by
         FROM ${quoteIdent(schema)}.dispatches
        WHERE claimed_by IS NOT NULL
          AND claimed_by <> $1
          AND claimed_at >= $2
        ORDER BY id`,
      [bridgeId, since],
    )
    return rows.map((row) => ({
      dispatch_id: Number(row.id),
      route_id: row.route_id,
      task_ref: row.task_ref,
      recipe: row.recipe,
      status: row.status,
      claimed_by: row.claimed_by,
    }))
  } catch (error) {
    notify(
      `could not check whether another bridge handled work on this schema, so this tally covers only ` +
        `what this bridge ran: ${error instanceof Error ? error.message : String(error)}`,
    )
    return []
  }
}

/** Route states the engine will never advance again. Mirrors hasLiveWork's inverse. */
const TERMINAL_ROUTE_STATUSES = ['complete', 'failed', 'cancelled'] as const

/**
 * Write the dossier for any route that has reached terminal state without one
 * (rsc-9y6 follow-up, docs/designs/run-dossier.md "Automatic capture").
 *
 * Until this existed, a dossier only got written if the ORCHESTRATOR remembered
 * to run `waypoint dossier` — the standing play in waypoint-agent/AGENTS.md. Aaron's
 * directive was that EVERY run be recorded, and "the agent remembers" is not a
 * mechanism: an agent that crashes, is cancelled, or simply does not follow its
 * instructions leaves no record of the run that most needed one. This removes the
 * agent from the loop, which is what the design asked for.
 *
 * WHY A SWEEP AND NOT A HOOK ON THE LAST DISPATCH: the bridge signals the engine
 * and the engine advances ASYNCHRONOUSLY. At the instant a route's final dispatch
 * returns, the route is usually still 'active' — a route almost never looks
 * terminal to the code that finished it. Checking there would miss nearly every
 * run. The daemon loop already re-drains on notify + poll, so the tick after the
 * engine settles sees the terminal row. That is also why this is daemon-only:
 * `--once` drains and leaves, so it is never around to observe the transition.
 *
 * Idempotent twice over — an in-memory set for the common case, and the file's
 * existence for a bridge that respawned (Console-supervised bridges park after
 * 60s idle and come back, so memory is not durable).
 *
 * NEVER throws into the claim loop. A dossier is a review artifact; failing to
 * write one must not fail a dispatch or kill the bridge. It reports loudly and
 * moves on — the run itself is already recorded in Postgres, which stays the
 * truth (the dossier is assembled FROM it).
 */
async function sweepTerminalRouteDossiers(
  pool: pg.Pool,
  schema: string,
  projectRoot: string,
  written: Set<string>,
  notify: (message: string) => void,
): Promise<void> {
  const s = quoteIdent(schema)
  let rows: { id: string }[]
  try {
    const result = await pool.query(
      `SELECT id FROM ${s}.routes WHERE status = ANY($1::text[])`,
      [TERMINAL_ROUTE_STATUSES],
    )
    rows = result.rows as { id: string }[]
  } catch (error) {
    notify(`dossier sweep: could not list terminal routes: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  for (const { id } of rows) {
    if (written.has(id)) continue
    if (existsSync(join(projectRoot, '.waypoint', 'reports', id, 'dossier.md'))) {
      written.add(id)
      continue
    }
    try {
      const result = await writeWaypointRunDossier(projectRoot, { routeId: id })
      notify(`dossier written for terminal route ${id}: ${result.markdownPath}`)
    } catch (error) {
      // Marked written regardless: a route whose dossier cannot be built would
      // otherwise be retried on every poll tick, forever, drowning the log that
      // would tell an operator why.
      notify(`dossier FAILED for terminal route ${id} (run is still recorded in postgres): ${error instanceof Error ? error.message : String(error)}`)
    }
    written.add(id)
  }
}

/**
 * Live work = a route the engine may still advance ('active' has timers and
 * running work; 'blocked' awaits a human whose decision mints a dispatch) or
 * a dispatch not yet closed. Everything else is terminal — idle-exit is safe.
 */
async function hasLiveWork(pool: pg.Pool, schema: string): Promise<boolean> {
  const s = quoteIdent(schema)
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM ${s}.routes WHERE status IN ('active', 'blocked'))
         OR EXISTS(SELECT 1 FROM ${s}.dispatches WHERE status IN ('pending', 'running')) AS live`,
  )
  return Boolean((result.rows[0] as { live?: boolean } | undefined)?.live)
}

/** The project's configured host concurrency (`runtime.worker.concurrency`). */
/**
 * The lanes this bridge may hand a dispatch to.
 *
 * A caller that injected its own runtime (tests, ad-hoc drains) keeps it: the
 * pool is that one runtime. Otherwise the project's lanes are built, and a
 * project without lanes yields exactly one — today's behavior.
 */
async function recipeRuntimeLanesFor(
  projectRoot: string,
  runtime: WaypointBridgeRecipeRuntime,
): Promise<
  readonly { readonly name: string | null; readonly email?: string; readonly runtime: WaypointBridgeRecipeRuntime }[]
> {
  const lanes = await createRecipeRuntimeLanes(projectRoot)
  // `=== 0`, not `<= 1`. A project with exactly ONE configured lane means it:
  // that is how a run is pinned to a single CLI. Falling back to the injected
  // runtime there discarded the pin silently and ran the default worker
  // command instead — a pinned "codex" cell that actually ran `claude -p
  // --model opus`, with nothing in the log to say so.
  return lanes.length === 0 ? [{ name: null, runtime }] : lanes
}

async function configuredConcurrency(projectRoot: string): Promise<number> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return config.runtime.worker?.concurrency ?? 1
  } catch {
    return 1
  }
}

/** Pending dispatch ids, oldest first (Q1: unconfigured-runtime reporting). */
async function pendingDispatchIds(pool: pg.Pool, schema: string): Promise<number[]> {
  const result = await pool.query(
    `SELECT id FROM ${quoteIdent(schema)}.dispatches
     WHERE status = 'pending'
     ORDER BY id`,
  )
  return (result.rows as { id: number }[]).map((row) => row.id)
}

/** Oldest pending dispatch, claimed atomically (FOR UPDATE SKIP LOCKED). */
/**
 * Close the queued work of routes the operator cancelled.
 *
 * Cancelling a route stopped the route, not its queue: pending dispatches were
 * claimed and run anyway, so agents did work for a run someone had already
 * killed — and on a busy case that work sat in front of the dispatch the
 * operator was waiting for (2026-08-19: two cancelled contact intakes ran
 * while the conversion they were queued ahead of waited fifteen minutes).
 *
 * Returns what it closed, so the bridge can say so rather than swallow it.
 */
export async function closeCancelledRouteDispatches(
  pool: pg.Pool,
  schema: string,
): Promise<readonly { readonly id: number; readonly route_id: string }[]> {
  const s = quoteIdent(schema)
  const result = await pool.query(
    `UPDATE ${s}.dispatches d SET status = 'failed', closed_at = now(),
       close_reason = 'route ' || d.route_id || ' was cancelled before this dispatch ran'
     WHERE d.status = 'pending'
       AND EXISTS (SELECT 1 FROM ${s}.routes r WHERE r.id = d.route_id AND r.status = 'cancelled')
     RETURNING d.id, d.route_id`,
  )
  return result.rows as readonly { readonly id: number; readonly route_id: string }[]
}

async function claimNextDispatch(pool: pg.Pool, schema: string, bridgeId: string): Promise<ClaimedDispatch | null> {
  const s = quoteIdent(schema)
  const result = await pool.query(
    `UPDATE ${s}.dispatches SET status = 'running', claimed_at = now(), claimed_by = $1
     WHERE id = (
       SELECT d.id FROM ${s}.dispatches d
       WHERE d.status = 'pending'
       ORDER BY d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
     )
     RETURNING id, route_id, task_ref, recipe, instance_id`,
    [bridgeId],
  )
  const row = result.rows[0] as ClaimedDispatch | undefined
  return row ?? null
}

/**
 * Return orphaned claims to the queue (B4.5): a bridge that died mid-attempt
 * leaves its dispatch at 'running' forever — the parked engine wait is
 * unharmed, but nothing would ever run the attempt (and `waypoint tasks retry`
 * refuses in_progress tasks). Claims are leased: live attempts heartbeat
 * claimed_at, so status='running' with a stale claimed_at can only mean a
 * dead process.
 */
async function reclaimStaleClaims(pool: pg.Pool, schema: string, leaseMs: number): Promise<number[]> {
  const s = quoteIdent(schema)
  const result = await pool.query(
    `UPDATE ${s}.dispatches SET status = 'pending', claimed_at = NULL, claimed_by = NULL
     WHERE status = 'running' AND claimed_at IS NOT NULL
       AND claimed_at < now() - ($1::bigint * interval '1 millisecond')
     RETURNING id`,
    [leaseMs],
  )
  return (result.rows as { id: number }[]).map((row) => row.id)
}

async function processDispatch(
  pool: pg.Pool,
  schema: string,
  projectRoot: string,
  runtime: WaypointBridgeRecipeRuntime,
  dispatch: ClaimedDispatch,
  bridgeId: string,
  options: RunWaypointBridgeOptions,
): Promise<WaypointBridgeProcessed> {
  const s = quoteIdent(schema)
  let task: DispatchTaskRow | null = null
  let outcome: WaypointBridgeProcessed['outcome']
  let payload: Record<string, unknown>
  // Liveness both ways (W4): the attempt aborts when the caller aborts OR
  // when this bridge loses its claim lease — the abort reaches the worker
  // runtime, which kills the agent's process group.
  const controller = new AbortController()
  const onOuterAbort = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })
  let leaseLost = false
  // Keep the claim lease fresh while the attempt runs (attempts can far
  // outlive the lease); a stale claimed_at then only ever means a dead
  // bridge. The beat is guarded on claimed_by: zero rows updated means the
  // claim was reclaimed and re-claimed elsewhere — the OTHER bridge now owns
  // this dispatch, so kill our attempt and write NOTHING (the row, the task,
  // and the engine signal all belong to the new owner).
  const leaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS
  const heartbeat = setInterval(() => {
    pool
      .query(`UPDATE ${s}.dispatches SET claimed_at = now() WHERE id = $1 AND status = 'running' AND claimed_by = $2`, [
        dispatch.id,
        bridgeId,
      ])
      .then((result) => {
        if (result.rowCount === 0 && !leaseLost) {
          leaseLost = true
          controller.abort()
        }
      })
      .catch(() => {}) // best-effort: a missed beat within the lease is harmless
  }, Math.max(1_000, Math.floor(leaseMs / 3)))
  try {
    task = await taskForDispatch(pool, schema, dispatch)
      // Ad-hoc routes (A2): the agent-authored recipes live in the route's
    // persisted session overlay (`.waypoint/agent/<sessionId>/catalog/`,
    // recorded as route metadata.overlay) — resolve from there, exactly as
    // the autopilot's catalogDir did.
      const overlay = await routeOverlayDir(pool, schema, dispatch.route_id)
      const recipe =
        runtime instanceof NullRecipeRuntime ? null : await loadRecipeManifest(projectRoot, dispatch.recipe, overlay)
      const priorAttempt = priorAttemptFromTask(task)
      const access = accessFromMetadata(task.metadata)
      const artifactContract = artifactContractFromMetadata(task.metadata)
      const review = reviewFromMetadata(task.metadata)
      const fanoutItem = fanoutItemFromMetadata(task.metadata)
      const gateFacing = await gateFacingForDispatch(pool, schema, projectRoot, dispatch.route_id, task.id, overlay)
      let output: { readonly status: string }
      if (recipe?.runtime?.kind === 'deterministic') {
      // Deterministic recipe (B2): a vetted host step, not an agent — run it
      // through the deterministic runtime (same Seatbelt jail, exit-code
      // outcome, no prompt/report). The graph, dispatch row and signal loop
      // are identical to an agent recipe's.
      const detRuntime = await deterministicRuntimeFor(projectRoot)
      output = await detRuntime.runRecipe({
        routeId: dispatch.route_id,
        taskId: task.id,
        taskRef: dispatch.task_ref,
        recipe: recipe.slug,
        ...(recipe.runtime.entrypoint ? { entrypoint: recipe.runtime.entrypoint } : {}),
        projectRoot,
        outputArtifacts: outputArtifactsFromMetadata(task.metadata),
        ...(access ? { access } : {}),
        signal: controller.signal,
      })
      } else if (recipe?.runtime?.kind === 'pi') {
      // Pi recipe (rsc-tka): the in-process pi-agent-core loop instead of
      // spawning claude -p. Same fork the autopilot takes; the dispatch row,
      // signal loop, and report-claim seam are identical to an agent recipe's.
      const piRuntime = await piRecipeRuntimeFor(projectRoot)
      output = await piRuntime.runRecipe({
        routeId: dispatch.route_id,
        taskId: task.id,
        recipe: recipe.slug,
        prompt: recipe.prompt,
        projectRoot,
        ...(recipe.runtime.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        ...(recipe.tools ? { tools: recipe.tools } : {}),
        ...(access ? { access } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: controller.signal,
      })
      } else if (recipe?.runtime?.kind === 'cordis') {
      // Cordis recipe (the Waypoint harness): the recipe names every layer of its
      // worker — skills, references, tools, model class — and the composer
      // refuses before a model is reached if any named thing does not resolve.
      // Same dispatch row, signal loop and report-claim seam as every other kind.
      // S2 (item 52): the admitted sandbox binding comes from the DURABLE ROUTE
      // ROW the start stamped — the route runs under the binding it started
      // with, not whatever the provisioning file says by the time it dispatches.
      const routeBinding = await routeSandboxBinding(pool, schema, dispatch.route_id)
      // L5: the lane is picked AT DISPATCH — pg session locks for cross-process
      // (and cross-product) exclusion, homes + brain reserve read fresh per pick.
      const cordisRuntime = await cordisRecipeRuntimeFor(projectRoot, {
        ...(routeBinding === undefined ? {} : { managedBinding: routeBinding }),
        lanePicker: createCordisLanePicker({ locks: createPgOauthLaneLocks(pool) }),
      })
      output = await cordisRuntime.runRecipe({
        routeId: dispatch.route_id,
        taskId: task.id,
        recipe,
        prompt: recipe.prompt,
        projectRoot,
        ...(recipe.runtime.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        outputArtifacts: outputArtifactsFromMetadata(task.metadata),
        ...(access ? { access } : {}),
        ...(fanoutItem ? { fanoutItem } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: controller.signal,
      })
      } else {
        output = await runtime.runRecipe({
        routeId: dispatch.route_id,
        taskId: task.id,
        taskRef: dispatch.task_ref,
        recipe: recipe?.slug ?? dispatch.recipe,
        prompt: recipe?.prompt ?? '',
        projectRoot,
        outputArtifacts: outputArtifactsFromMetadata(task.metadata),
        ...(artifactContract ? { artifactContract } : {}),
        ...(review ? { review } : {}),
        ...(gateFacing ? { gateFacing: true } : {}),
        ...(recipe?.runtime?.model_class ? { modelClass: recipe.runtime.model_class } : {}),
        ...(recipe?.runtime?.tool_group ? { toolGroup: recipe.runtime.tool_group } : {}),
        ...(fanoutItem ? { fanoutItem } : {}),
        ...(access ? { access } : {}),
        ...(priorAttempt ? { priorAttempt } : {}),
        signal: controller.signal,
        })
      }
      outcome = normalizeOutcome(output.status)
      // rsc-xam: redact credentials BEFORE the payload becomes durable. This is the
      // one choke point — every path below (signal into the durable instance,
      // evidence on the task row, and the retry that reads that evidence back into
      // the next agent's PROMPT) flows from this object.
      payload = maskEvidencePayload({ ...output, status: outcome })
  } catch (error) {
    // A runtime crash is a failed attempt with the error as evidence. Masked too:
    // an agent command can fail with the credential in its own error text.
    outcome = 'failed'
    payload = maskEvidencePayload({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
  }

  try {
    if (leaseLost) {
      // At-least-once seam, same as the substrate's peek-lock: if the
      // attempt actually finished in the instant the lease was stolen, the
      // result is dropped and the new owner re-runs the task.
      return {
        dispatch_id: dispatch.id,
        route_id: dispatch.route_id,
        task_ref: dispatch.task_ref,
        recipe: dispatch.recipe,
        outcome: 'stopped',
        engine_advanced: false,
      }
    }
    // The ACCOUNT refused, not the work: put the dispatch back on the queue
    // and leave the task exactly as it was. Recording a failure here would
    // burn the task on one subscription's billing cycle (Aaron 2026-08-02).
    const refusal = outcome === 'finished' ? null : accountRefusal(payload)
    if (refusal !== null) {
      await pool.query(
        `UPDATE ${s}.dispatches SET status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2`,
        [dispatch.id, bridgeId],
      )
      return {
        dispatch_id: dispatch.id,
        route_id: dispatch.route_id,
        task_ref: dispatch.task_ref,
        recipe: dispatch.recipe,
        outcome,
        engine_advanced: false,
        account_refusal: refusal,
      }
    }
    let engineAdvanced = false
    let autoRetry: AutoRetryDecision | undefined
    if (outcome === 'finished') {
      engineAdvanced = await signalDurableInstance(pool, dispatch.instance_id, `task:${dispatch.task_ref}`, payload, {
        ...(options.signalConfirmTimeoutMs === undefined ? {} : { timeoutMs: options.signalConfirmTimeoutMs }),
        ...(options.signal === undefined ? {} : { abort: options.signal }),
      })
    } else if (task !== null) {
      // Non-finished attempt: record it off-graph (the engine's wait stays
      // parked — a retry dispatch's finished outcome will resume the graph).
      await recordAttemptOffGraph(projectRoot, dispatch, task, outcome, payload)
      // rsc-m23.6: and then, if this failure looks incidental and the task has
      // attempts left, put it straight back on the queue. `stopped` is a human
      // cancelling and is never retried; `exhausted` is the budget, which a
      // retry would only spend again.
      if (outcome === 'failed') {
        autoRetry = await maybeAutoRetry(pool, s, projectRoot, dispatch, task, payload)
      }
    }

    // The agent's claim (its report row) IS the file it wrote; the runtime
    // read it and it rode back inside the masked payload. The HOST records it
    // on the dispatch here — the worker has no route to Postgres to do so
    // itself (rsc-452). A deterministic step or a crash carries no claim, so
    // the column stays null. COALESCE guards the W1 CLI path, which may have
    // already filled it on a manually-claimed dispatch.
    const reportJson = isRecord(payload.report) ? JSON.stringify(payload.report) : null
    // S2 (item 52): the ADMITTED binding the attempt entered rides the same
    // close — the dispatch row is the durable record of where the work
    // physically ran. Absent/null on the output means the attempt ran outside
    // a VM, and the column honestly stays null.
    const sandboxJson = isRecord(payload.sandbox) ? JSON.stringify(payload.sandbox) : null

    // Ownership-guarded close (W4): a steal in the instant since the last
    // heartbeat must not have its row clobbered by us. The engine signal (if
    // any) already went out — that residual overlap is the accepted
    // at-least-once seam, same window as the signal protocol's.
    await pool.query(
      `UPDATE ${s}.dispatches SET status = $2, close_reason = $3, report = COALESCE($5, report), sandbox = COALESCE($6, sandbox), closed_at = now() WHERE id = $1 AND claimed_by = $4`,
      [
        dispatch.id,
        outcome === 'finished' && !engineAdvanced ? 'failed' : 'completed',
        outcome === 'finished' && !engineAdvanced ? `signal not consumed (${outcome})` : outcome,
        bridgeId,
        reportJson,
        sandboxJson,
      ],
    )
    return {
      dispatch_id: dispatch.id,
      route_id: dispatch.route_id,
      task_ref: dispatch.task_ref,
      recipe: dispatch.recipe,
      outcome,
      engine_advanced: engineAdvanced,
      ...(autoRetry === undefined ? {} : { auto_retry: autoRetry }),
    }
  } finally {
    clearInterval(heartbeat)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * Bounded auto re-dispatch (rsc-m23.6): a failed attempt puts itself back on
 * the queue instead of parking the whole route on a human.
 *
 * Why this exists, from the run that forced it (vance-fanout route-001,
 * 2026-08-08): one fan-out arm wrote both its encounter pages, recorded 18
 * document close-outs and diagnosed a provider-naming mismatch nobody else
 * caught — then ended without calling its `report` tool. The attempt recorded
 * as failed, wave 2 never completed, and the route sat dead with seven tasks
 * open until a human noticed and typed `tasks retry`. The work was fine; the
 * report was missing. A route must always reach human review — that is what
 * the durable substrate is for, and a step that can be re-run from its own
 * checkpoint should re-run itself.
 *
 * The bounds matter as much as the retry:
 * - `max_attempts` (config `runtime.worker.max_attempts`, default 3) caps the
 *   total attempts per task, so a genuinely broken step costs three runs, not
 *   an infinite loop.
 * - The SAME close reason twice stops it immediately. A retry is a bet that the
 *   failure was incidental; an identical failure is the bet losing, and burning
 *   the remaining attempts on it just delays the human.
 * - Exhausting the attempts leaves the task failed for a human, which is the
 *   existing off-graph behaviour — the route still reaches review, now with
 *   every attempt on the record rather than one.
 */
const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Pre-enter infrastructure refusals get their OWN bound (route-014,
 * 2026-08-31): the fleet was busy recycling two sick placements, every queued
 * attempt burned a 30s Sprites-API timeout as a task attempt, and two
 * identical timeouts tripped the same-reason brake — the route died in ten
 * minutes with the task logic never once at fault. A refusal that no worker
 * ever ran behind is backpressure, not evidence about the task; it re-queues
 * without charging an attempt. The consecutive cap keeps a permanently sick
 * fleet visible: park for a human instead of cycling forever.
 */
const MAX_CONSECUTIVE_INFRA_REFUSALS = 10

export interface AutoRetryDecision {
  readonly retry: boolean
  readonly attempts: number
  readonly maxAttempts: number
  readonly reason: string
}

export function decideAutoRetry(input: {
  readonly attempts: number
  readonly maxAttempts: number
  readonly closeReason: string | null
  readonly previousCloseReason: string | null
  /** Run length of infra refusals ending at THIS failure (it included). */
  readonly consecutiveInfraRefusals?: number
  /** The ROUTE's current status — a cancelled route never re-queues. */
  readonly routeStatus?: string
}): AutoRetryDecision {
  const { attempts, maxAttempts } = input
  const base = { attempts, maxAttempts }
  // Route-015 (2026-08-31): an operator cancel raced the retry ladder — the
  // requeue path INSERTed a fresh dispatch and flipped the route back to
  // 'active', un-cancelling it, after which the drain's cancelled-route sweep
  // matched nothing and the dead run churned on. A cancel is the operator's
  // final word: record the leftover attempt, re-queue nothing.
  if (input.routeStatus === 'cancelled') {
    return {
      ...base,
      retry: false,
      reason: 'route cancelled by the operator — leftover attempt recorded; nothing re-queued',
    }
  }
  if (maxAttempts <= 1) return { ...base, retry: false, reason: 'auto retry disabled (max_attempts <= 1)' }
  if (input.closeReason !== null && input.closeReason.startsWith(CORDIS_INFRA_REFUSAL_PREFIX)) {
    const consecutive = Math.max(1, input.consecutiveInfraRefusals ?? 1)
    if (consecutive >= MAX_CONSECUTIVE_INFRA_REFUSALS) {
      return {
        ...base,
        retry: false,
        reason:
          `the sandbox fleet refused ${consecutive} consecutive enters — no worker ever ran, so this is ` +
          'infrastructure, not the task; parked for a human (check sprite placements and the Sprites API)',
      }
    }
    return {
      ...base,
      retry: true,
      reason:
        `enter refused by infrastructure before any worker ran (${consecutive}/${MAX_CONSECUTIVE_INFRA_REFUSALS} ` +
        'consecutive) — re-queued without charging a task attempt',
    }
  }
  if (attempts >= maxAttempts) {
    return { ...base, retry: false, reason: `attempts exhausted (${attempts}/${maxAttempts}) — parked for a human` }
  }
  // A clean exit whose report row says 'failed' is a VERDICT, not a crash —
  // the QC recipe reporting NOT-READY, a verifier reporting unmet checks.
  // Re-dispatching asks the same question of the same inputs (route-349,
  // 2026-08-15: a 231-document QC re-ran for nothing). Failing now hands the
  // route to the route-level ladder, whose re-run actually changes inputs.
  if (input.closeReason?.startsWith("agent reported 'failed'")) {
    return {
      ...base,
      retry: false,
      reason: "the agent deliberately reported 'failed' — a verdict, not a crash; the route-level rework is the retry",
    }
  }
  if (
    input.closeReason !== null &&
    input.previousCloseReason !== null &&
    input.closeReason === input.previousCloseReason
  ) {
    return {
      ...base,
      retry: false,
      reason: `failed the same way twice (${input.closeReason}) — retrying again would only delay the human`,
    }
  }
  return { ...base, retry: true, reason: `attempt ${attempts}/${maxAttempts} failed; re-dispatching` }
}

/**
 * Decide, and act: count this task's attempts, compare the last two close
 * reasons, and re-queue when the bounds allow. Every outcome is recorded as a
 * route event so the dossier shows the retry chain rather than one failure.
 */
async function maybeAutoRetry(
  pool: pg.Pool,
  s: string,
  projectRoot: string,
  dispatch: ClaimedDispatch,
  task: DispatchTaskRow,
  payload: Record<string, unknown>,
): Promise<AutoRetryDecision> {
  let maxAttempts = DEFAULT_MAX_ATTEMPTS
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    const configured = config.runtime.worker?.max_attempts
    if (typeof configured === 'number' && Number.isInteger(configured) && configured > 0) maxAttempts = configured
  } catch {
    // Unreadable config keeps the default; a retry policy is not worth failing a dispatch over.
  }

  // Attempts = every dispatch ever made for this task, this one included —
  // MINUS the infra-refused ones, where no worker ever ran (route-014): a
  // refusal the fleet produced must not spend the budget that exists to
  // bound the TASK's own failures.
  const countResult = await pool.query(
    `SELECT count(*)::int AS n FROM ${s}.dispatches WHERE route_id = $1 AND task_ref = $2`,
    [dispatch.route_id, dispatch.task_ref],
  )
  const totalDispatches = (countResult.rows[0] as { n: number } | undefined)?.n ?? 1
  // The previous attempt's REAL close reason lives in its failure event —
  // the dispatch row's close_reason column stores the outcome word
  // ('failed'), which the payload's reason ('process exited 1') can never
  // equal, so comparing against it left the same-reason brake dead code:
  // every identical failure re-ran to exhaustion. Found when a test pinned
  // the brake's arithmetic and the count came back 9, not 6. The newest
  // failed event is THIS attempt (recordAttemptOffGraph just appended it);
  // the one before it is the previous attempt.
  const history = await pool.query(
    `SELECT payload#>>'{runtime,close_reason}' AS reason FROM ${s}.route_events
      WHERE route_id = $1 AND kind = 'route.bridge.task.failed' AND payload->>'node' = $2
      ORDER BY ord DESC LIMIT 50`,
    [dispatch.route_id, dispatch.task_ref],
  )
  const reasons = history.rows.map((row) => (row as { reason: string | null }).reason)
  const isInfra = (reason: string | null | undefined): boolean =>
    typeof reason === 'string' && reason.startsWith(CORDIS_INFRA_REFUSAL_PREFIX)
  // The same-reason brake compares REAL failures: infra refusals between two
  // identical task failures are fleet noise, not a reset of the bet.
  const previous = reasons.slice(1).find((reason) => !isInfra(reason)) ?? null
  const infraTotal = reasons.filter(isInfra).length
  let consecutiveInfraRefusals = 0
  for (const reason of reasons) {
    if (!isInfra(reason)) break
    consecutiveInfraRefusals += 1
  }
  const attempts = Math.max(1, totalDispatches - infraTotal)
  const closeReason = typeof payload.close_reason === 'string' ? payload.close_reason : null

  // Read the route's status LAST, so a cancel that landed while this attempt
  // ran is seen here — the requeue below must never resurrect it.
  const routeStatusResult = await pool.query(`SELECT status FROM ${s}.routes WHERE id = $1`, [dispatch.route_id])
  const routeStatus = (routeStatusResult.rows[0] as { status?: string } | undefined)?.status

  const decision = decideAutoRetry({
    attempts,
    maxAttempts,
    closeReason,
    previousCloseReason: previous,
    consecutiveInfraRefusals,
    routeStatus,
  })

  if (decision.retry) {
    const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
    const recipeMeta = isRecord(runner.recipe) ? runner.recipe : {}
    const recipe = typeof recipeMeta.slug === 'string' && recipeMeta.slug.trim() !== '' ? recipeMeta.slug : dispatch.recipe
    await pool.query(
      `INSERT INTO ${s}.dispatches (route_id, task_ref, recipe, instance_id) VALUES ($1, $2, $3, $4)`,
      [dispatch.route_id, dispatch.task_ref, recipe, dispatch.instance_id],
    )
    // The failed attempt just marked the route 'failed' (off-graph parity,
    // recordAttemptOffGraph) — but a queued retry means the run is NOT over.
    // Left terminal, the dossier sweep records the run mid-retry and a
    // successful retry leaves a route that says 'failed' over a task that
    // says 'done' (rsc-3srd, seen in vivo on route-003 of the proof case).
    // Exhaustion keeps the terminal status: that IS the park-for-a-human.
    await updateWaypointRoute(projectRoot, dispatch.route_id, {
      status: 'active',
      current_node: dispatch.task_ref,
      updated_at: new Date().toISOString(),
    })
    // The next attempt reads the last one's evidence out of the task row, the
    // same way `tasks retry` feeds it into the work order.
    await registerBridgeProject(projectRoot)
  }

  await appendRouteEvent(projectRoot, dispatch.route_id, {
    kind: decision.retry
      ? 'task.retry.auto'
      : routeStatus === 'cancelled'
        ? 'task.retry.cancelled'
        : 'task.retry.exhausted',
    payload: {
      task_ref: dispatch.task_ref,
      attempts: decision.attempts,
      max_attempts: decision.maxAttempts,
      reason: decision.reason,
      ...(typeof payload.close_reason === 'string' ? { close_reason: payload.close_reason } : {}),
    },
  })
  return decision
}

/**
 * Record a non-finished attempt without touching the engine: task status +
 * evidence (as `metadata.runner.evidence` — the `evidence` COLUMN stays the
 * engine's), route status (autopilot-parity mapping), and an event. All via
 * the same store seam the autopilot writes through.
 */
async function recordAttemptOffGraph(
  projectRoot: string,
  dispatch: ClaimedDispatch,
  task: DispatchTaskRow,
  outcome: 'failed' | 'exhausted' | 'stopped',
  payload: Record<string, unknown>,
): Promise<void> {
  const statusByOutcome = { failed: 'failed', exhausted: 'blocked', stopped: 'cancelled' } as const
  const routeStatusByOutcome = { failed: 'failed', exhausted: 'blocked', stopped: 'cancelled' } as const
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const now = new Date()
  await updateWaypointTask(projectRoot, task.id, {
    status: statusByOutcome[outcome],
    updated_at: now.toISOString(),
    metadata: { ...(task.metadata ?? {}), runner: { ...runner, evidence: payload } },
  })
  await updateWaypointRoute(projectRoot, dispatch.route_id, {
    status: routeStatusByOutcome[outcome],
    current_node: dispatch.task_ref,
    updated_at: now.toISOString(),
  })
  await appendRouteEvent(projectRoot, dispatch.route_id, {
    kind: `route.bridge.task.${outcome}`,
    now,
    payload: { task_id: task.id, node: dispatch.task_ref, dispatch_id: dispatch.id, runtime: payload },
  })
}

/** The route's ad-hoc overlay catalog dir (metadata.overlay), if any. */
async function routeOverlayDir(pool: pg.Pool, schema: string, routeId: string): Promise<string | undefined> {
  const result = await pool.query(`SELECT metadata FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [routeId])
  const metadata = (result.rows[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata
  const overlay = isRecord(metadata) ? metadata.overlay : undefined
  return typeof overlay === 'string' && overlay.trim() !== '' ? overlay : undefined
}

/**
 * S2 (item 52): the admitted sandbox binding the START stamped on the route
 * row (`metadata.sandbox`). `undefined` for routes with no sandbox and for
 * pre-S2 routes — the runtime factory then falls back to the provisioning
 * record file, so an in-flight route from before the stamping never bricks.
 */
async function routeSandboxBinding(pool: pg.Pool, schema: string, routeId: string): Promise<unknown> {
  const result = await pool.query(`SELECT metadata FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [routeId])
  const metadata = (result.rows[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata
  return isRecord(metadata) && isRecord(metadata.sandbox) ? metadata.sandbox : undefined
}

interface DispatchTaskRow {
  readonly id: string
  readonly status: string
  readonly metadata: Record<string, unknown> | null
  readonly evidence: Record<string, unknown> | null
}

async function taskForDispatch(pool: pg.Pool, schema: string, dispatch: ClaimedDispatch): Promise<DispatchTaskRow> {
  const result = await pool.query(
    `SELECT id, status, metadata, evidence FROM ${quoteIdent(schema)}.tasks WHERE route_id = $1 AND plan_ref = $2`,
    [dispatch.route_id, dispatch.task_ref],
  )
  const row = result.rows[0] as DispatchTaskRow | undefined
  if (!row) throw new Error(`dispatch ${dispatch.id}: no task for route ${dispatch.route_id} plan_ref ${dispatch.task_ref}`)
  return row
}

/**
 * Whether finishing *taskId* opens a human gate that still has no
 * plain-language brief (Aaron 2026-08-14: no approval reaches a gate without
 * one). The LAST task before the next gate that is capable of briefing
 * carries the requirement — a task is released only by a later CAPABLE task,
 * never by a checkpoint, a wait, or a deterministic host step (*mute*): the
 * medical layer's gate sat directly behind its deterministic coverage-sensor
 * step, adjacency put the requirement on a step with no report seam, and the
 * gate opened briefless again (found in vivo, 2026-08-14). And if some
 * already-reported task the gate will present left a brief, the gate has its
 * note and nothing more is owed. Same-wave siblings each carry it; whichever
 * briefs first releases nobody, which errs strict rather than mute.
 */
export function gateFacingInGraph(
  tasks: readonly { id: string; kind: string | null; wave: number | null }[],
  taskId: string,
  briefed: ReadonlySet<string>,
  mute: ReadonlySet<string> = new Set(),
): boolean {
  const wave = (t: { wave: number | null }): number | null =>
    typeof t.wave === 'number' && Number.isFinite(t.wave) ? t.wave : null
  const mine = tasks.find((t) => t.id === taskId)
  const myWave = mine ? wave(mine) : null
  if (myWave === null) return false
  const gateWaves = tasks
    .filter((t) => t.kind === 'gate')
    .map(wave)
    .filter((w): w is number => w !== null && w > myWave)
  if (gateWaves.length === 0) return false
  const gateWave = Math.min(...gateWaves)
  const capableBetween = tasks.some((t) => {
    const w = wave(t)
    return t.kind === 'recipe' && !mute.has(t.id) && w !== null && w > myWave && w < gateWave
  })
  if (capableBetween) return false
  return !tasks.some((t) => {
    const w = wave(t)
    return t.kind !== 'gate' && w !== null && w < gateWave && briefed.has(t.id)
  })
}

/** The bridge-side lookup behind {@link gateFacingInGraph}: the route's task
 * graph, which tasks' reports already carry a brief, and which tasks are
 * MUTE — deterministic host steps with no report seam, told apart by their
 * recipe manifest. Fails OPEN at every read — a transient failure must not
 * reject good work with a spurious demand. */
async function gateFacingForDispatch(
  pool: pg.Pool,
  schema: string,
  projectRoot: string,
  routeId: string,
  taskId: string,
  overlay: string | undefined,
): Promise<boolean> {
  try {
    const s = quoteIdent(schema)
    const tasks = await pool.query(`SELECT id, kind, wave, metadata FROM ${s}.tasks WHERE route_id = $1`, [routeId])
    const signals = await pool.query(
      `SELECT payload FROM ${s}.route_events WHERE route_id = $1 AND kind = 'task.signal'`,
      [routeId],
    )
    const briefed = new Set<string>()
    for (const row of signals.rows as { payload: unknown }[]) {
      const payload = isRecord(row.payload) ? row.payload : {}
      const data = isRecord(payload.data) ? payload.data : {}
      const report = isRecord(data.report) ? data.report : {}
      if (typeof data.task_id === 'string' && typeof report.brief === 'string' && report.brief.trim() !== '') {
        briefed.add(data.task_id)
      }
    }
    const rows = (
      tasks.rows as { id: string; kind: string | null; wave: number | string | null; metadata: unknown }[]
    ).map((row) => ({
      id: row.id,
      kind: row.kind,
      wave: row.wave === null ? null : Number(row.wave),
      metadata: row.metadata,
    }))
    const mute = new Set<string>()
    for (const row of rows) {
      if (row.kind !== 'recipe' || row.id === taskId) continue
      const runner = isRecord(row.metadata) && isRecord(row.metadata.runner) ? row.metadata.runner : {}
      const slug =
        isRecord(runner.recipe) && typeof runner.recipe.slug === 'string' ? runner.recipe.slug : null
      if (slug === null) continue
      try {
        const manifest = await loadRecipeManifest(projectRoot, slug, overlay)
        if (manifest.runtime?.kind === 'deterministic') mute.add(row.id)
      } catch {
        // Unreadable manifest: assume the task can brief, which RELEASES the
        // current one — fail open, never a spurious rejection.
      }
    }
    return gateFacingInGraph(rows, taskId, briefed, mute)
  } catch {
    return false
  }
}

/**
 * Retry-with-evidence, durable world: a re-dispatched task whose previous
 * attempt did not finish carries that attempt's recorded evidence into the
 * work order (rsc-f3v) so the retry does not start blind. Bridge-recorded
 * attempts live in `metadata.runner.evidence`; the `evidence` column (the
 * engine's) is the fallback.
 */
function priorAttemptFromTask(task: DispatchTaskRow): RecipeRuntimePriorAttempt | undefined {
  if (task.status !== 'failed' && task.status !== 'blocked' && task.status !== 'cancelled') return undefined
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const evidence = isRecord(runner.evidence) ? runner.evidence : task.evidence
  if (!isRecord(evidence)) return undefined
  const stdout = typeof evidence.stdout === 'string' ? evidence.stdout.trim() : ''
  const stderr = typeof evidence.stderr === 'string' ? evidence.stderr.trim() : ''
  const error = typeof evidence.error === 'string' ? evidence.error : ''
  const apply = isRecord(evidence.apply) ? evidence.apply : {}
  return {
    status: 'failed',
    close_reason:
      typeof evidence.close_reason === 'string'
        ? evidence.close_reason
        : typeof evidence.outcome === 'string'
          ? evidence.outcome
          : null,
    missing: Array.isArray(apply.missing) ? apply.missing.filter((item): item is string => typeof item === 'string') : [],
    output_tail: [stdout, stderr && stdout ? `--- stderr ---\n${stderr}` : stderr, !stdout && !stderr ? error : '']
      .filter((part) => part !== '')
      .join('\n'),
  }
}

/** The one fan-out item this plan owns (`metadata.runner.fanout_item`,
 * rsc-m23.7) — written by the start-time expansion, read back here so the
 * dispatch can name it in the work order and scope the tool surface to it. */
function fanoutItemFromMetadata(
  metadata: Record<string, unknown> | null,
): { slug: string; label: string; path?: string } | undefined {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  const item = isRecord(runner.fanout_item) ? runner.fanout_item : undefined
  if (item === undefined || typeof item.slug !== 'string' || item.slug.trim().length === 0) return undefined
  return {
    slug: item.slug,
    label: typeof item.label === 'string' && item.label.trim().length > 0 ? item.label : item.slug,
    ...(typeof item.path === 'string' && item.path.trim().length > 0 ? { path: item.path } : {}),
  }
}

function outputArtifactsFromMetadata(metadata: Record<string, unknown> | null): string[] {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  if (!Array.isArray(runner.output_artifacts)) return []
  return runner.output_artifacts.filter((artifact): artifact is string => typeof artifact === 'string' && artifact.trim().length > 0)
}

/** The plan's vetted content contract (`metadata.runner.artifact_contract`,
 * rsc-6al) — name only; the runtime resolves it against the registry and
 * fails closed on unknowns. */
function artifactContractFromMetadata(metadata: Record<string, unknown> | null): string | undefined {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  return typeof runner.artifact_contract === 'string' && runner.artifact_contract.trim().length > 0
    ? runner.artifact_contract
    : undefined
}

/** The plan's declared review (`metadata.runner.review`, rsc-8vw): the checks
 * whose passing verdicts the report must itemize before the plan is admitted.
 * Shape-checked only; the runtime does the fail-closed evaluation. An empty or
 * malformed check list yields undefined — no review declared. */
function reviewFromMetadata(metadata: Record<string, unknown> | null): { independent: boolean; checks: string[] } | undefined {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  const review = isRecord(runner.review) ? runner.review : null
  if (review === null || !Array.isArray(review.checks)) return undefined
  const checks = review.checks.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  if (checks.length === 0) return undefined
  return { independent: review.independent === true, checks }
}

/** The plan's `access:` map from task metadata (`metadata.runner.access`),
 * shape-checked only — the jail's assembly does the fail-closed enforcement. */
function accessFromMetadata(metadata: Record<string, unknown> | null): Record<string, string> | undefined {
  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  if (!isRecord(runner.access)) return undefined
  const access: Record<string, string> = {}
  for (const [binding, mode] of Object.entries(runner.access)) {
    if (typeof mode === 'string') access[binding] = mode
  }
  return access
}

/** The four worker outcomes; 'simulated' (null runtime) completes the node. */
function normalizeOutcome(status: string): WaypointBridgeProcessed['outcome'] {
  if (status === 'finished' || status === 'simulated') return 'finished'
  if (status === 'exhausted') return 'exhausted'
  if (status === 'stopped') return 'stopped'
  return 'failed'
}

export interface SignalDurableInstanceOptions {
  readonly timeoutMs?: number
  readonly abort?: AbortSignal
}

/**
 * Read the engine's wait-node status for one signal name:
 * 'pending' (not reached), 'running' (parked, signalable), 'completed'
 * (already consumed — the signal was decided), or undefined (no such node).
 */
export async function durableSignalNodeStatus(pool: pg.Pool, instanceId: string, signalName: string): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT status FROM df.instance_nodes($1)
     WHERE node_type = 'SIGNAL' AND query LIKE $2
     ORDER BY updated_at DESC LIMIT 1`,
    [instanceId, `%"signal_name":"${signalName}"%`],
  )
  return (result.rows[0] as { status?: string } | undefined)?.status
}

/**
 * Deliver a signal the engine is guaranteed to hear: wait until the target
 * wait node is parked (`running`), send, then confirm it flipped to
 * `completed`. This is the required protocol (executed finding, 2026-07-11):
 * a signal sent before the wait registers is silently dropped. Residual race
 * accepted for P2: if the wait times out in the instant between our
 * running-check and the send, the confirm sees the timeout's `completed` and
 * reports success while the loop re-parks; the next `waypoint tasks retry`
 * recovers. Window is sub-second against an 1800-second budget.
 */
export async function signalDurableInstance(
  pool: pg.Pool,
  instanceId: string,
  signalName: string,
  payload: Record<string, unknown>,
  options: SignalDurableInstanceOptions = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_SIGNAL_CONFIRM_TIMEOUT_MS)
  let sent = false
  while (Date.now() < deadline) {
    if (options.abort?.aborted) return false
    const status = await durableSignalNodeStatus(pool, instanceId, signalName)
    if (status === 'completed' && sent) return true
    if (status === 'running') {
      // Re-send every tick until consumption is confirmed. Send-once is NOT
      // safe on pg_durable 0.2.4 — executed finding (B4.5, 2026-07-12): the
      // SIGNAL node reads 'running' before the wait subscription can
      // actually receive, and a signal landing in that window is silently
      // dropped (send-once stalled the gates E2E deterministically, 2/2
      // runs; re-send passed 2/2). Tradeoff: extra same-name signals queue
      // on the instance — inert here, since every signal name has exactly
      // one wait, consumed once. Liveness beats cosmetic engine-table rows.
      await pool.query('SELECT df.signal($1, $2, $3)', [instanceId, signalName, JSON.stringify(payload)])
      sent = true
    }
    await sleep(SIGNAL_POLL_MS)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryDurableTaskResult {
  readonly dispatch_id: number
  readonly route_id: string
  readonly task_ref: string
  readonly recipe: string
}

/**
 * `waypoint tasks retry` on a durable route: the parked retry loop (compiler,
 * B3) is waiting on `task:<ref>` — a retry is simply a fresh dispatch row.
 * The bridge claims it, runs the runtime with the failed attempt's evidence
 * (priorAttemptFromTask), and its outcome signal resumes the loop.
 */
export async function retryDurableWaypointTask(projectRoot: string, taskId: string): Promise<RetryDurableTaskResult> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const taskResult = await pool.query(
    `SELECT id, route_id, plan_ref, kind, status, metadata FROM ${s}.tasks WHERE id = $1`,
    [taskId],
  )
  const task = taskResult.rows[0] as
    | { id: string; route_id: string; plan_ref: string; kind: string; status: string; metadata: Record<string, unknown> | null }
    | undefined
  if (!task) throw new Error(`No task found with id ${taskId}`)
  if (task.status !== 'failed' && task.status !== 'blocked' && task.status !== 'cancelled') {
    throw new Error(`tasks retry on a durable run applies to failed/blocked/cancelled tasks; ${taskId} is '${task.status}'`)
  }
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const recipeMeta = isRecord(runner.recipe) ? runner.recipe : {}
  const recipe = typeof recipeMeta.slug === 'string' && recipeMeta.slug.trim() !== '' ? recipeMeta.slug : null
  if (recipe === null) {
    throw new Error(`Task ${taskId} (${task.plan_ref}) has no metadata.runner.recipe.slug — only recipe tasks are re-dispatched`)
  }
  const routeResult = await pool.query(`SELECT instance_id FROM ${s}.routes WHERE id = $1`, [task.route_id])
  const instanceId = (routeResult.rows[0] as { instance_id: string | null } | undefined)?.instance_id
  if (typeof instanceId !== 'string' || instanceId === '') {
    throw new Error(`Run ${task.route_id} has no engine instance id — was it started with backend.postgres.durable: true?`)
  }
  const inserted = await pool.query(
    `INSERT INTO ${s}.dispatches (route_id, task_ref, recipe, instance_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [task.route_id, task.plan_ref, recipe, instanceId],
  )
  const dispatchId = (inserted.rows[0] as { id: number }).id
  // A1: a fresh dispatch on a possibly-parked project — touch the bridge
  // registry so the Console supervisor respawns a bridge to claim it.
  await registerBridgeProject(projectRoot)
  return { dispatch_id: dispatchId, route_id: task.route_id, task_ref: task.plan_ref, recipe }
}

// --- W1: the agent report seam (P3, docs/designs/p3-worker-host.md) --------

/**
 * What a worker agent may claim about its own attempt. The report is DATA:
 * the host derives the run outcome from process exit x report (never agent
 * say-so - 2026-05-06 rule), and every consumer renders it as fenced text.
 */
export interface DurableTaskAttemptReport {
  readonly status: 'finished' | 'failed'
  readonly summary: string
  readonly evidence?: Readonly<Record<string, string>>
}

export interface ReportDurableTaskAttemptResult {
  readonly dispatch_id: number
  readonly route_id: string
  readonly task_ref: string
}

/**
 * `waypoint tasks report` (agent-facing): write the attempt report onto the
 * task's CLAIMED ('running') dispatch row. First write wins - a second
 * report on the same attempt is refused, keeping the trail honest. Requires
 * a running dispatch: reporting is only meaningful while the host is holding
 * the attempt open.
 */
export async function reportDurableTaskAttempt(
  projectRoot: string,
  taskId: string,
  report: DurableTaskAttemptReport,
): Promise<ReportDurableTaskAttemptResult> {
  if (report.summary.trim() === '') throw new Error('a report requires a non-empty --summary')
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const taskResult = await pool.query(`SELECT id, route_id, plan_ref FROM ${s}.tasks WHERE id = $1`, [taskId])
  const task = taskResult.rows[0] as { id: string; route_id: string; plan_ref: string } | undefined
  if (!task) throw new Error(`No task found with id ${taskId}`)

  const updated = await pool.query(
    `UPDATE ${s}.dispatches
     SET report = $3
     WHERE id = (
       SELECT id FROM ${s}.dispatches
       WHERE route_id = $1 AND task_ref = $2 AND status = 'running' AND report IS NULL
       ORDER BY id DESC LIMIT 1
     )
     RETURNING id`,
    [
      task.route_id,
      task.plan_ref,
      JSON.stringify({
        status: report.status,
        summary: report.summary,
        ...(report.evidence !== undefined && Object.keys(report.evidence).length > 0 ? { evidence: report.evidence } : {}),
        reported_at: new Date().toISOString(),
      }),
    ],
  )
  const row = updated.rows[0] as { id: number } | undefined
  if (!row) {
    const running = await pool.query(
      `SELECT id, report IS NOT NULL AS reported FROM ${s}.dispatches
       WHERE route_id = $1 AND task_ref = $2 AND status = 'running' ORDER BY id DESC LIMIT 1`,
      [task.route_id, task.plan_ref],
    )
    const existing = running.rows[0] as { id: number; reported: boolean } | undefined
    if (existing?.reported) {
      throw new Error(`Attempt ${existing.id} for ${taskId} (${task.plan_ref}) already has a report - one report per attempt`)
    }
    throw new Error(`No running attempt for ${taskId} (${task.plan_ref}) - reports apply to the claimed dispatch only`)
  }
  return { dispatch_id: row.id, route_id: task.route_id, task_ref: task.plan_ref }
}

export interface DurableTaskAttemptRow {
  readonly dispatch_id: number
  readonly status: string
  readonly close_reason: string | null
  readonly report: Record<string, unknown> | null
  /**
   * The attempt's REAL failure reason — 'deterministic step exited 2: <stderr
   * tail>' and friends — read from this dispatch's bridge failure event. The
   * dispatch row's close_reason column stores only the outcome word, which is
   * why an operator staring at `tasks show` used to see 'failed' and nothing
   * else while the diagnosis sat one table over (2026-08-25 ledger entry).
   */
  readonly failure_detail: string | null
  /** The failed process's captured stderr, when the failure event carries it. */
  readonly failure_stderr: string | null
}

/** Latest attempt (dispatch) for a task, for `waypoint tasks show`. */
export async function latestDurableTaskAttempt(projectRoot: string, taskId: string): Promise<DurableTaskAttemptRow | null> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  const taskResult = await pool.query(`SELECT route_id, plan_ref FROM ${s}.tasks WHERE id = $1`, [taskId])
  const task = taskResult.rows[0] as { route_id: string; plan_ref: string } | undefined
  if (!task) return null
  const result = await pool.query(
    `SELECT id, status, close_reason, report FROM ${s}.dispatches
     WHERE route_id = $1 AND task_ref = $2 ORDER BY id DESC LIMIT 1`,
    [task.route_id, task.plan_ref],
  )
  const row = result.rows[0] as { id: number; status: string; close_reason: string | null; report: Record<string, unknown> | null } | undefined
  if (!row) return null
  let failureDetail: string | null = null
  let failureStderr: string | null = null
  if (row.close_reason !== null && row.close_reason !== 'finished') {
    const failure = await pool.query(
      `SELECT payload#>>'{runtime,close_reason}' AS detail, payload#>>'{runtime,stderr}' AS stderr
         FROM ${s}.route_events
        WHERE route_id = $1 AND kind LIKE 'route.bridge.task.%' AND payload->>'dispatch_id' = $2
        ORDER BY ord DESC LIMIT 1`,
      [task.route_id, String(row.id)],
    )
    const event = failure.rows[0] as { detail: string | null; stderr: string | null } | undefined
    failureDetail = event?.detail ?? null
    failureStderr = event?.stderr ?? null
  }
  return {
    dispatch_id: row.id,
    status: row.status,
    close_reason: row.close_reason,
    report: row.report,
    failure_detail: failureDetail,
    failure_stderr: failureStderr,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What the project's config looked like, cheaply.
 *
 * Size and mtime are enough to notice an operator edit between dispatches;
 * the point is never to run for days on a config nobody can see any more.
 */
export async function configFingerprint(projectRoot: string): Promise<string> {
  try {
    const info = await stat(getWaypointProjectPaths(projectRoot).configPath)
    return `${info.size}:${info.mtimeMs}`
  } catch {
    return 'absent'
  }
}
