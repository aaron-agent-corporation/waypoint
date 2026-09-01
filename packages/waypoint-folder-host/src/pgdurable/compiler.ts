/**
 * Scaffold → pg_durable graph compiler (P2/B1).
 *
 * Compiles a quest's scaffold plans into ONE `SELECT df.start(...)` SQL text —
 * mirroring the worked example at
 * docs/spikes/pg-durable-substrate/demo/02_route_code_review.sql.
 *
 * Determinism contract (golden-filed, like tools/prose):
 * - Byte-stable output for identical input — no timestamps, no randomness.
 * - The compiler translates; it never authors. Every free-text value
 *   (plan_ref, title, recipe slug, quest slug) is copied verbatim from the
 *   quest object.
 * - Injection discipline lives here: values interpolated into single-quoted
 *   SQL context are escaped (single quotes doubled); each node's SQL is
 *   dollar-quoted with a sequential tag that is deterministically extended
 *   with 'x' while the node's content (including its header comment, which
 *   carries the verbatim title) contains the candidate tag.
 */


import { artifactContractFor, knownArtifactContracts } from '../runtime/artifact-contracts.ts'
import { extractScaffoldPlans, taskKindFor, type ScaffoldPlan } from '../tasks/store.ts'
import { substituteStartVariables, whenPredicateFor, whenPredicateProblems } from './when.ts'

export interface CompileQuestToDurableGraphInput {
  readonly routeId: string
  readonly schema: string
  readonly quest: { readonly scaffolds?: unknown; readonly repeat?: unknown }
  /** X5: values for the {waypoint_*} start-time variables, resolved into
   * when-predicate CONDITION nodes at compile time (see pgdurable/when.ts
   * for why this is not df.setvar). Deterministic given identical values. */
  readonly variables?: Record<string, string>
}

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const ROUTE_ID_PATTERN = /^[a-z0-9-]+$/
const SECONDS_PER_DAY = 86400


/**
 * routes/tasks/route_events carry TEXT timestamps in the P1 stores
 * (Date.toISOString() shape); engine-side writes must match byte-for-byte so
 * the read models stay backend-agnostic.
 */
const UTC_TIMESTAMP_SQL = `to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

export function compileQuestToDurableGraph(input: CompileQuestToDurableGraphInput): string {
  if (!SCHEMA_PATTERN.test(input.schema)) {
    throw new Error(`invalid schema name: ${JSON.stringify(input.schema)} (expected /^[a-z_][a-z0-9_]{0,62}$/)`)
  }
  if (!ROUTE_ID_PATTERN.test(input.routeId)) {
    throw new Error(`invalid route id: ${JSON.stringify(input.routeId)} (expected /^[a-z0-9-]+$/)`)
  }
  const plans = extractScaffoldPlans(input.quest.scaffolds)
  if (plans.length === 0) throw new Error('quest has no scaffold plans to compile')
  assertDurableAdmissiblePlans(plans)
  const questSlug = readQuestSlug(input.quest)
  const repeatDays = repeatEveryDaysFor(input.quest)
  if (repeatDays !== undefined) assertRepeatSafePlans(plans)

  const ctx: EmitContext = {
    schema: input.schema,
    routeId: input.routeId,
    counters: { node: 0, event: 0 },
    lines: [],
    emittedAny: false,
    elements: 0,
    planBoundaries: [],
    ...(input.variables !== undefined ? { variables: input.variables } : {}),
  }

  // Self-register the df instance id onto the route row FIRST — before any
  // plan node and before any parallel group — so bridge/gate tooling can
  // always find the instance. current_node starts at the first plan's ref.
  const registerComment = 'register engine instance on the route row'
  emitComment(ctx, registerComment)
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.routes`,
      `SET instance_id = '{sys_instance_id}', current_node = '${sq(plans[0]!.plan_ref)}', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE id = '${ctx.routeId}'`,
    ],
    registerComment,
  )

  for (const group of groupPlansByWave(plans)) {
    // A plan-group start is an admissible chunk cut: no capture is read
    // across it (every `$sig` reference follows its own capture within the
    // same plan's element run).
    ctx.planBoundaries.push({ line: ctx.lines.length, elements: ctx.elements })
    if (group.length === 1) {
      emitPlan(ctx, group[0]!)
    } else {
      emitParallelWave(ctx, group)
    }
  }

  if (repeatDays !== undefined) {
    // X4: a repeating quest wraps the WHOLE graph in `@> (...)` — a df.loop
    // iteration is ContinuedAsNew (fresh history, every node re-executes
    // from the top), so the loop can only ever be the outermost construct
    // and the body must be safe to re-execute (assertRepeatSafePlans).
    // No terminal state: a repeating route never completes — it runs until
    // cancelled. Each pass appends a tick event (runtime-derived id in its
    // own `event-r<N>` namespace, NO dedupe key: a crash-replayed iteration
    // re-executes the body, so an extra tick truthfully marks an extra
    // execution), then parks on the interval sleep.
    const tickComment = 'repeat: iteration tick, then park until the next pass'
    emitComment(ctx, tickComment)
    emitSqlNode(
      ctx,
      [
        `INSERT INTO ${ctx.schema}.route_events (id, route_id, kind, payload, created_at)`,
        `SELECT 'event-r' || ((SELECT count(*) FROM ${ctx.schema}.route_events`,
        `                     WHERE route_id = '${ctx.routeId}' AND id LIKE 'event-r%') + 1)::text,`,
        `       '${ctx.routeId}', 'route.repeat.tick', ${jsonSqlLiteral({ quest: questSlug, every_days: repeatDays })}, ${UTC_TIMESTAMP_SQL}`,
      ],
      tickComment,
    )
    emitRawNode(ctx, `df.sleep(${sleepSeconds(repeatDays)})`)
    return `SELECT df.start(\n\n  @> (\n\n${chunkLongChain(ctx).join('\n')}\n\n  ),\n\n  '${ctx.routeId}'\n);\n`
  }

  // Terminal contract (conformance-pinned): a complete route has NO current
  // node — current_node = NULL, matching the folder reference backend.
  const terminalComment = 'route terminal state'
  emitComment(ctx, terminalComment)
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.routes SET status = 'complete', current_node = NULL, updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE id = '${ctx.routeId}'`,
    ],
    terminalComment,
  )
  emitSqlNode(ctx, eventLines(ctx, 'route.complete', jsonSqlLiteral({ quest: questSlug })), terminalComment)

  const lines = chunkLongChain(ctx)
  lines[lines.length - 1] += ','
  return `SELECT df.start(\n\n${lines.join('\n')}\n\n  '${ctx.routeId}'\n);\n`
}

/**
 * Q3 (docs/designs/q-quest-proving.md): pg_durable 0.2.4's expression parser
 * breaks on a LINEAR chain longer than 127 elements — the tail of the chain
 * is swallowed into a single mis-parsed SQL leaf that fails at runtime with
 * `syntax error at or near "{"` and the instance parks failed (reproduced by
 * bisection: 127 chained nodes parse, 128 break; parentheses reset the
 * counter — 220 nodes as nested groups run fine). The largest bundled quest's 93
 * plans compile past that limit, so long top-level chains are chunked into
 * parenthesized groups of at most MAX_CHAIN_RUN elements, cut only at
 * plan-group boundaries (no capture is read across a plan boundary — every
 * `$sig` reference follows its own capture inside the same plan's element
 * run). THEN is associative, so grouping changes the parse shape, never the
 * execution order. Graphs at or under the limit assemble byte-identically to
 * before. Re-probe on pg_durable upgrade.
 */
const MAX_CHAIN_RUN = 100

function chunkLongChain(ctx: EmitContext): string[] {
  if (ctx.elements <= MAX_CHAIN_RUN) return [...ctx.lines]

  // Greedy cuts: close a chunk at the last plan boundary before the element
  // count since the previous cut would exceed MAX_CHAIN_RUN. Plan groups
  // contribute a handful of elements each, so chunks stay well under 127.
  const cuts: number[] = []
  let chunkStartElements = 0
  let previous: { readonly line: number; readonly elements: number } | undefined
  for (const boundary of ctx.planBoundaries) {
    if (previous !== undefined && boundary.elements - chunkStartElements > MAX_CHAIN_RUN) {
      cuts.push(previous.line)
      chunkStartElements = previous.elements
    }
    previous = boundary
  }
  if (previous !== undefined && previous.line > 0 && ctx.elements - chunkStartElements > MAX_CHAIN_RUN && !cuts.includes(previous.line)) {
    cuts.push(previous.line)
  }
  if (cuts.length === 0) return [...ctx.lines]

  const out: string[] = ['  (']
  let sliceStart = 0
  for (const cut of [...cuts, ctx.lines.length]) {
    const segment = ctx.lines.slice(sliceStart, cut)
    if (sliceStart > 0) {
      // The chunk's first chain element carries the '  ~> ' prefix from the
      // original flat chain; inside its own group it is the first element.
      const first = segment.findIndex((line) => line.startsWith('  ~> '))
      if (first !== -1) segment[first] = `  ${segment[first]!.slice(5)}`
      out.push('  )', '  ~> (')
    }
    out.push(...segment)
    sliceStart = cut
  }
  out.push('  )')
  return out
}

/**
 * Q2 admission (docs/designs/q-quest-proving.md, rsc-e1b): only node kinds
 * with an HONEST durable mapping may compile. Before this pass, `artifact`,
 * `handoff` and every unknown node type silently fell through to the
 * auto-done checkpoint emit — the referral-package run marked
 * "Inventory source documents" done in 4 seconds with its declared
 * artifact_verifier never run and the artifact absent from disk.
 *
 * Admissible: recipe (dispatch), gate (human signal), wait (timer/landmark),
 * checkpoint (the documented deliberate auto-done marker), and discussion
 * (folder-era kind with marker semantics — the flagship `runner` quest
 * carries one; re-authoring it is the rsc-e1b item-4 sweep, not a compile
 * concern). Everything else refuses: authors must say what executes the
 * plan, or say `checkpoint` and mean it.
 */
const DURABLE_ADMISSIBLE_KINDS = new Set(['recipe', 'gate', 'wait', 'checkpoint', 'discussion'])

function assertDurableAdmissiblePlans(plans: readonly ScaffoldPlan[]): void {
  for (const plan of plans) {
    const runner = isRecord(plan.metadata?.runner) ? plan.metadata.runner : {}
    const node = isRecord(runner.node) ? runner.node : {}
    if (typeof node.type === 'string' && !DURABLE_ADMISSIBLE_KINDS.has(node.type)) {
      throw new Error(
        `plan '${plan.plan_ref}' has node type '${node.type}', which has no durable execution mapping — it would silently auto-complete with no work done; author it as a recipe (worker-executed) or an explicit checkpoint marker (fail closed)`,
      )
    }
    const kind = taskKindFor(plan.metadata)
    const autoDone = kind !== 'recipe' && kind !== 'gate' && kind !== 'wait'
    if (autoDone && isRecord(runner.artifact_verifier)) {
      throw new Error(
        `plan '${plan.plan_ref}' declares artifact_verifier but compiles to an auto-done ${kind} — the verifier would never run, so 'done' would be unverified by construction; back the plan with a recipe or drop the verifier (fail closed)`,
      )
    }
    // rsc-6al admission: a content contract must name vetted host code and
    // sit on a plan whose runtime actually enforces it.
    if (runner.artifact_contract !== undefined) {
      const contract = runner.artifact_contract
      if (typeof contract !== 'string' || artifactContractFor(contract) === null) {
        throw new Error(
          `plan '${plan.plan_ref}' declares artifact_contract '${String(contract)}', which is not in the vetted contract registry (known: ${knownArtifactContracts().join(', ')}) — an unenforceable contract would let 'done' go unverified; fix the name or drop it (fail closed)`,
        )
      }
      if (autoDone) {
        throw new Error(
          `plan '${plan.plan_ref}' declares artifact_contract but compiles to an auto-done ${kind} — the contract would never run; back the plan with a recipe (fail closed)`,
        )
      }
    }
  }
}

/**
 * X4 admission: the quest-level `repeat` block. Fail closed — a `repeat` key
 * that is present but not `{every_days: <positive finite number>}` is an
 * error, never ignored.
 */
function repeatEveryDaysFor(quest: { readonly repeat?: unknown }): number | undefined {
  if (quest.repeat === undefined) return undefined
  const repeat = quest.repeat
  const everyDays = isRecord(repeat) ? repeat.every_days : undefined
  if (typeof everyDays !== 'number' || !Number.isFinite(everyDays) || everyDays <= 0) {
    throw new Error('quest repeat.every_days must be a positive finite number of days (fail closed)')
  }
  return everyDays
}

/**
 * X4 guardrail, citing the ContinuedAsNew finding (2026-07-12): every loop
 * iteration re-executes the WHOLE graph with fresh history — consumed
 * signals are lost and dispatches would re-enqueue. So a repeating quest may
 * carry only checkpoint-family plans and timer-only waits (df.sleep replays
 * harmlessly). Recipes (dispatch), gates (human signal wait), and landmark
 * waits (signal wait) refuse to compile.
 */
function assertRepeatSafePlans(plans: readonly ScaffoldPlan[]): void {
  for (const plan of plans) {
    const kind = taskKindFor(plan.metadata)
    const offense =
      kind === 'recipe'
        ? 'a recipe dispatch would re-enqueue a worker run every iteration'
        : kind === 'gate'
          ? 'a gate parks on a human signal, and consumed signals are lost on iteration'
          : kind === 'wait' && waitLandmarkFor(plan) !== undefined
            ? 'a landmark wait parks on a signal, and consumed signals are lost on iteration'
            : undefined
    if (offense !== undefined) {
      throw new Error(
        `repeating quest contains ${kind} '${plan.plan_ref}' — ${offense}; df.loop iterations are ContinuedAsNew and re-execute the whole graph (fail closed)`,
      )
    }
  }
}

/** Node/event ordinals — shared between the root context and every
 * parallel-branch context so tags and event ids stay unique across the
 * whole graph. (Capture names are deliberately NOT unique — see nextSignal.) */
interface EmitCounters {
  node: number
  event: number
}

interface EmitContext {
  readonly schema: string
  readonly routeId: string
  readonly counters: EmitCounters
  readonly lines: string[]
  emittedAny: boolean
  /** Chain elements emitted into THIS context (Q3 chunking, see MAX_CHAIN_RUN). */
  elements: number
  /** Root context only: (line index, elements-so-far) at each plan-group start —
   * the admissible cut points for chunking a long top-level chain. */
  readonly planBoundaries: { readonly line: number; readonly elements: number }[]
  readonly variables?: Record<string, string>
}

/** Fresh line buffer sharing the parent's counters — for parallel-wave
 * branches (X1) and df.if arms (X2), whose lines nest inside parentheses. */
function branchContext(ctx: EmitContext): EmitContext {
  return {
    schema: ctx.schema,
    routeId: ctx.routeId,
    counters: ctx.counters,
    lines: [],
    emittedAny: false,
    elements: 0,
    planBoundaries: [],
    ...(ctx.variables !== undefined ? { variables: ctx.variables } : {}),
  }
}

/** Consecutive plans in the same phase sharing the same non-null wave form a
 * parallel group (X1, docs/designs/df-operator-coverage.md); everything else
 * stays a singleton. Wave numbers reset per phase across the corpus, so the
 * phase is part of the group key. */
function groupPlansByWave(plans: readonly ScaffoldPlan[]): ScaffoldPlan[][] {
  const groups: ScaffoldPlan[][] = []
  for (const plan of plans) {
    const current = groups[groups.length - 1]
    if (current !== undefined && plan.wave !== null && current[0]!.wave === plan.wave && current[0]!.phase === plan.phase) {
      current.push(plan)
      continue
    }
    groups.push([plan])
  }
  return groups
}

/**
 * X1: a parallel wave compiles to branches joined with `&` — the engine runs
 * them concurrently and proceeds only when ALL branches complete.
 *
 * Contract decisions:
 * - current_node during the wave = the group's FIRST plan ref, set by a
 *   marker node BEFORE the join. Branch nodes never write the routes row —
 *   a shared single pointer under concurrent writers is a race, not a
 *   contract. The next node after the join advances it.
 * - Gates cannot run inside a parallel group (fail closed): a gate is a
 *   human decision point that blocks the whole route; branches contending
 *   for the route's blocked/active status would lie to the operator.
 */
function emitParallelWave(ctx: EmitContext, group: readonly ScaffoldPlan[]): void {
  const first = group[0]!
  for (const plan of group) {
    if (taskKindFor(plan.metadata) === 'gate') {
      throw new Error(
        `parallel wave ${first.wave} in phase '${first.phase}' contains gate '${plan.plan_ref}' — gates are human decision points and cannot run inside a parallel group (fail closed)`,
      )
    }
  }
  const marker = `wave ${first.wave} (parallel): ${group.map((plan) => plan.plan_ref).join(', ')}`
  emitComment(ctx, marker)
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.routes SET current_node = '${sq(first.plan_ref)}', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE id = '${ctx.routeId}'`,
    ],
    marker,
  )

  const branches = group.map((plan) => {
    const branch = branchContext(ctx)
    emitPlan(branch, plan, { inWave: true })
    return branch.lines
  })

  ctx.lines.push(`${chainPrefix(ctx)}(`)
  branches.forEach((lines, index) => {
    ctx.lines.push(index === 0 ? '  (' : '  & (')
    ctx.lines.push(...lines)
    ctx.lines.push('  )')
  })
  ctx.lines.push('  )')
  ctx.emittedAny = true
}

function emitPlan(ctx: EmitContext, plan: ScaffoldPlan, options: { inWave?: boolean } = {}): void {
  const kind = taskKindFor(plan.metadata)
  const recipeSlug = kind === 'recipe' ? recipeSlugFor(plan) : undefined
  const waitDays = kind === 'wait' ? waitDaysFor(plan) : undefined
  const comment = commentFor(plan, kind, recipeSlug)
  const when = whenPredicateFor(plan.plan_ref, plan.metadata)

  if (when === undefined) {
    emitComment(ctx, comment)
    emitPlanBody(ctx, plan, kind, recipeSlug, waitDays, comment, options.inWave === true)
    return
  }

  // X2 admission (fail closed): raw predicate SQL is the one place an author
  // could smuggle an invalid node into the graph, so anything outside the
  // admissible shape refuses to compile.
  if (kind === 'gate') {
    throw new Error(
      `plan '${plan.plan_ref}' is a gate with a when predicate — gates are human decision points and are never machine-skipped (fail closed)`,
    )
  }
  const problems = whenPredicateProblems(when)
  if (problems.length > 0) {
    throw new Error(`plan '${plan.plan_ref}' has an inadmissible when predicate (fail closed): ${problems.join('; ')}`)
  }
  emitComment(ctx, `${comment} [when-guarded]`)
  emitWhenGuardedPlan(ctx, plan, when, kind, recipeSlug, waitDays, comment, options.inWave === true)
}

function emitPlanBody(
  ctx: EmitContext,
  plan: ScaffoldPlan,
  kind: string,
  recipeSlug: string | undefined,
  waitDays: number | undefined,
  comment: string,
  inWave: boolean,
): void {
  if (kind === 'recipe' && recipeSlug !== undefined) {
    emitRecipePlan(ctx, plan, recipeSlug, comment, inWave)
  } else if (kind === 'gate') {
    // Humans decide, never the clock (locked norm): a gate carrying a wait
    // block would smuggle a deadline onto a human decision point.
    if (isRecord(plan.metadata?.runner) && isRecord((plan.metadata.runner as Record<string, unknown>).wait)) {
      throw new Error(
        `gate '${plan.plan_ref}' carries a wait block — gates park indefinitely; humans decide, never the clock (fail closed)`,
      )
    }
    emitGatePlan(ctx, plan, comment)
  } else if (kind === 'wait') {
    const landmark = waitLandmarkFor(plan)
    if (landmark !== undefined) {
      emitLandmarkWaitPlan(ctx, plan, waitDays, comment, inWave)
    } else if (waitDays !== undefined) {
      emitWaitPlan(ctx, plan, waitDays, comment)
    } else {
      // Before X3 this shape silently compiled to an auto-done checkpoint.
      throw new Error(
        `wait plan '${plan.plan_ref}' has neither wait.days nor a landmark — an unbounded, unresolvable wait cannot compile (fail closed)`,
      )
    }
  } else {
    emitCheckpointPlan(ctx, plan, comment)
  }
}

/**
 * X2: a plan with a `when:` predicate compiles to df.if(condition, then, else).
 * The condition node carries the predicate VERBATIM (dollar-quoted; the
 * admission rules above guarantee no '$', so the tag can never collide or
 * close early). Truthy ⇒ the plan's normal chain runs. Falsy ⇒ the task is
 * recorded done with `{skipped: true}` evidence plus a `route.task.skipped`
 * event, and the chain continues — a skipped plan is visible in the record,
 * never silently absent. Neither arm of the else writes the routes row, so
 * the shape composes inside parallel waves unchanged.
 */
function emitWhenGuardedPlan(
  ctx: EmitContext,
  plan: ScaffoldPlan,
  when: string,
  kind: string,
  recipeSlug: string | undefined,
  waitDays: number | undefined,
  comment: string,
  inWave: boolean,
): void {
  // X5: the CONDITION carries the resolved predicate (start-time variables
  // substituted at compile time — see when.ts for the df.setvar finding);
  // evidence and the skip event keep the AUTHORED text, which is what an
  // auditor wants on record.
  const resolved = substituteStartVariables(when, ctx.variables)
  ctx.counters.node += 1
  const condLines = renderTagged(`n${ctx.counters.node}`, resolved.split('\n'), '  ', comment)
  condLines[condLines.length - 1] += ','

  const thenBranch = branchContext(ctx)
  emitPlanBody(thenBranch, plan, kind, recipeSlug, waitDays, comment, inWave)

  const elseBranch = branchContext(ctx)
  emitSqlNode(
    elseBranch,
    [
      `UPDATE ${ctx.schema}.tasks`,
      `SET status = 'done', evidence = ${jsonSqlLiteral({ skipped: true, when })}, updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE route_id = '${ctx.routeId}' AND plan_ref = '${sq(plan.plan_ref)}'`,
    ],
    comment,
  )
  emitSqlNode(elseBranch, eventLines(elseBranch, 'route.task.skipped', jsonSqlLiteral({ plan_ref: plan.plan_ref, when })), comment)

  ctx.lines.push(`${chainPrefix(ctx)}df.if(`)
  ctx.lines.push(...condLines)
  ctx.lines.push('  (')
  ctx.lines.push(...thenBranch.lines)
  ctx.lines.push('  ),')
  ctx.lines.push('  (')
  ctx.lines.push(...elseBranch.lines)
  ctx.lines.push('  )')
  ctx.lines.push('  )')
  ctx.emittedAny = true
}

/** checkpoint (and any kind without a dedicated mapping): task done + event. */
function emitCheckpointPlan(ctx: EmitContext, plan: ScaffoldPlan, comment: string): void {
  emitSqlNode(ctx, taskStatusLines(ctx, 'done', plan.plan_ref), comment)
  emitSqlNode(ctx, eventLines(ctx, 'task.done', jsonSqlLiteral({ plan_ref: plan.plan_ref })), comment)
}

/**
 * recipe: dispatch row + ONE indefinite wait for the completion signal (B4
 * final shape). The graph is the HAPPY PATH: the bridge signals the engine
 * only when an attempt FINISHES; failed/exhausted/stopped attempts are
 * recorded off-graph by the bridge (task status + evidence + event, route
 * blocked) while the wait stays parked, and a retry dispatch's finished
 * outcome resumes it. No timeout: attempt budgets are enforced by the
 * recipe runtimes, not the clock on the wait.
 *
 * Why not a df.loop retry loop: df.loop iterates via ContinuedAsNew — the
 * new execution starts with FRESH history and re-executes every node from
 * the top (executed finding, 2026-07-12: duplicated events/dispatches,
 * current_node regression). Loops are unusable in a graph whose nodes have
 * side effects; single parked waits survive crashes (B0/B2 evidence) and
 * carry all the durability this graph needs.
 */
function emitRecipePlan(ctx: EmitContext, plan: ScaffoldPlan, recipeSlug: string, comment: string, inWave = false): void {
  const ref = plan.plan_ref
  emitSqlNode(ctx, taskStatusLines(ctx, 'in_progress', ref), comment)
  // Idempotent under node re-execution (B4.5): duroxide activities are
  // at-least-once — a crash between this INSERT's commit and its ack re-runs
  // the node, and a bare VALUES insert would enqueue a duplicate worker run.
  // The engine emits at most one dispatch per (instance, task) — retry rows
  // are inserted by `waypoint tasks retry` AFTER this one exists, so the guard
  // never blocks them.
  emitSqlNode(
    ctx,
    [
      `INSERT INTO ${ctx.schema}.dispatches (route_id, task_ref, recipe, instance_id)`,
      `SELECT '${ctx.routeId}', '${sq(ref)}', '${sq(recipeSlug)}', '{sys_instance_id}'`,
      `WHERE NOT EXISTS (SELECT 1 FROM ${ctx.schema}.dispatches`,
      `                  WHERE instance_id = '{sys_instance_id}' AND task_ref = '${sq(ref)}')`,
    ],
    comment,
  )
  const sig = nextSignal(ctx)
  emitRawNode(ctx, `df.wait_for_signal('task:${sq(ref)}') |=> '${sig}'`)
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.tasks`,
      `SET status = 'done', evidence = ($${sig}::jsonb)->'data', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE route_id = '${ctx.routeId}' AND plan_ref = '${sq(ref)}'`,
    ],
    comment,
  )
  if (!inWave) {
    // Inside a parallel wave the branches never write the routes row (X1
    // contract: the wave marker holds current_node until the join passes).
    emitSqlNode(
      ctx,
      [
        `UPDATE ${ctx.schema}.routes SET status = 'active', current_node = '${sq(ref)}', updated_at = ${UTC_TIMESTAMP_SQL}`,
        `WHERE id = '${ctx.routeId}'`,
      ],
      comment,
    )
  }
  emitSqlNode(ctx, eventLines(ctx, 'task.signal', `$${sig}::jsonb`), comment)
}

/**
 * gate: route/task block + ONE wait_for_signal with NO timeout (Waypoint gates
 * park indefinitely — humans decide, never the clock). By the B4 signal
 * contract only an APPROVE is ever signalled: `waypoint gate --reject`
 * records the rejection off-graph (route stays blocked, gate stays
 * decidable — P1 semantics) and leaves the wait parked, so the graph only
 * ever advances past approved gates. The recording stays truthful for a
 * hand-sent signal (CASE on the decision), but never signal gates by hand —
 * use `waypoint gate`. Approve ⇒ task done (lineage-derived contract from the
 * endstate decision doc) + 'route.gate.approved' event, then the route
 * un-blocks.
 */
function emitGatePlan(ctx: EmitContext, plan: ScaffoldPlan, comment: string): void {
  const ref = plan.plan_ref
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.routes SET status = 'blocked', current_node = '${sq(ref)}', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE id = '${ctx.routeId}'`,
    ],
    comment,
  )
  emitSqlNode(ctx, taskStatusLines(ctx, 'blocked', ref), comment)
  const sig = nextSignal(ctx)
  const approveSql = `($${sig}::jsonb->'data'->>'decision') = 'approve'`
  // A confirmation gate whose question is already answered is retired by a
  // reconcile-style caller, not decided by a human. It rides the approve
  // signal because the engine only understands approve-or-fail, so the actor
  // marker is what keeps the record honest: this run advanced because a
  // recorded fact made the question moot, and Waypoint approved nothing.
  const mootSql = `${approveSql} AND ($${sig}::jsonb->'data'->>'actor') = 'system-reconcile'`
  const decisionPayload = `jsonb_build_object('node', '${sq(ref)}', 'decision', ($${sig}::jsonb)->'data')`
  emitRawNode(ctx, `df.wait_for_signal('gate:${sq(ref)}') |=> '${sig}'`)
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.tasks`,
      `SET status = CASE WHEN ${approveSql} THEN 'done' ELSE 'failed' END,`,
      `    evidence = ($${sig}::jsonb)->'data', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE route_id = '${ctx.routeId}' AND plan_ref = '${sq(ref)}'`,
    ],
    comment,
  )
  emitSqlNode(
    ctx,
    eventLinesWithKindSql(
      ctx,
      `CASE WHEN ${mootSql} THEN 'route.gate.moot' WHEN ${approveSql} THEN 'route.gate.approved' ELSE 'route.gate.rejected' END`,
      decisionPayload,
    ),
    comment,
  )
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.routes SET status = 'active', updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE id = '${ctx.routeId}'`,
    ],
    comment,
  )
}

/** Whole seconds for df.sleep — its signature is integer-typed, so a
 * fractional days value would emit a numeric literal the engine rejects
 * (executed finding, X3: `df.sleep(numeric) does not exist`). */
function sleepSeconds(days: number): number {
  return Math.round(days * SECONDS_PER_DAY)
}

/** wait, timer-only shape: df.sleep(days * 86400) + task done + event. */
function emitWaitPlan(ctx: EmitContext, plan: ScaffoldPlan, days: number, comment: string): void {
  emitRawNode(ctx, `df.sleep(${sleepSeconds(days)})`)
  emitSqlNode(ctx, taskStatusLines(ctx, 'done', plan.plan_ref), comment)
  emitSqlNode(ctx, eventLines(ctx, 'task.wait.elapsed', jsonSqlLiteral({ plan_ref: plan.plan_ref })), comment)
}

/**
 * X3: a wait with a landmark is a DEADLINE wait — "the landmark is observed
 * OR the clock elapses", compiling to df.race(df.wait_for_signal, df.sleep).
 * Before X3 these compiled to the sleep alone, silently dropping the authored
 * landmark half (every wait in the corpus carries one). With no days the wait
 * parks indefinitely on the signal alone.
 *
 * The landmark signal is `wait:<ref>`, sent (re-send until confirmed, B4.5)
 * by `waypoint resume --resolve-blocker` — the same command that resolves waits
 * on the folder backend. The elapsed arm chains a marker node after
 * the sleep so the winner is distinguishable: engine-wrapped signal values
 * always carry a 'data' envelope, the marker never does. Evidence and the
 * event kind (task.wait.resolved vs task.wait.elapsed) CASE on that — the
 * record states WHY the wait ended, not just that it did.
 *
 * Gates never come here: humans decide, never the clock (locked norm) — a
 * gate carrying a wait block is a compile error upstream.
 */
function emitLandmarkWaitPlan(
  ctx: EmitContext,
  plan: ScaffoldPlan,
  days: number | undefined,
  comment: string,
  inWave: boolean,
): void {
  const ref = plan.plan_ref
  if (!inWave) {
    // Park visibly, gate-style: the operator finds the wait at current_node.
    // Inside a parallel wave branches never write the routes row (X1).
    emitSqlNode(
      ctx,
      [
        `UPDATE ${ctx.schema}.routes SET status = 'blocked', current_node = '${sq(ref)}', updated_at = ${UTC_TIMESTAMP_SQL}`,
        `WHERE id = '${ctx.routeId}'`,
      ],
      comment,
    )
  }
  emitSqlNode(ctx, taskStatusLines(ctx, 'blocked', ref), comment)

  const sig = nextSignal(ctx)
  if (days === undefined) {
    emitRawNode(ctx, `df.wait_for_signal('wait:${sq(ref)}') |=> '${sig}'`)
  } else {
    ctx.lines.push(`${chainPrefix(ctx)}df.race(`)
    ctx.lines.push(`  df.wait_for_signal('wait:${sq(ref)}'),`)
    ctx.lines.push(`  df.sleep(${sleepSeconds(days)})`)
    ctx.counters.node += 1
    ctx.lines.push(
      ...renderTagged(`n${ctx.counters.node}`, [`SELECT '${sq(JSON.stringify({ elapsed: true, days }))}'`], '  ~> ', comment),
    )
    ctx.lines.push(`  ) |=> '${sig}'`)
    ctx.emittedAny = true
  }

  const resolvedSql = `($${sig}::jsonb ? 'data')`
  emitSqlNode(
    ctx,
    [
      `UPDATE ${ctx.schema}.tasks`,
      `SET status = 'done',`,
      `    evidence = CASE WHEN ${resolvedSql} THEN ($${sig}::jsonb)->'data' ELSE ($${sig}::jsonb) END,`,
      `    updated_at = ${UTC_TIMESTAMP_SQL}`,
      `WHERE route_id = '${ctx.routeId}' AND plan_ref = '${sq(ref)}'`,
    ],
    comment,
  )
  emitSqlNode(
    ctx,
    eventLinesWithKindSql(
      ctx,
      `CASE WHEN ${resolvedSql} THEN 'task.wait.resolved' ELSE 'task.wait.elapsed' END`,
      `jsonb_build_object('node', '${sq(ref)}', 'result', CASE WHEN ${resolvedSql} THEN ($${sig}::jsonb)->'data' ELSE ($${sig}::jsonb) END)`,
    ),
    comment,
  )
  if (!inWave) {
    emitSqlNode(
      ctx,
      [
        `UPDATE ${ctx.schema}.routes SET status = 'active', updated_at = ${UTC_TIMESTAMP_SQL}`,
        `WHERE id = '${ctx.routeId}'`,
      ],
      comment,
    )
  }
}

function commentFor(plan: ScaffoldPlan, kind: string, recipeSlug: string | undefined): string {
  const wavePrefix = plan.wave === null ? '' : `wave ${plan.wave}: `
  const descriptor = recipeSlug === undefined ? `${kind} ${plan.plan_ref}` : `recipe ${recipeSlug}`
  return `${wavePrefix}${plan.title} (${descriptor})`
}

function recipeSlugFor(plan: ScaffoldPlan): string {
  const runner = isRecord(plan.metadata?.runner) ? plan.metadata.runner : {}
  const recipe = isRecord(runner.recipe) ? runner.recipe : {}
  if (typeof recipe.slug === 'string' && recipe.slug.length > 0) return recipe.slug
  throw new Error(`recipe plan '${plan.plan_ref}' has no metadata.runner.recipe.slug`)
}

function waitDaysFor(plan: ScaffoldPlan): number | undefined {
  const runner = isRecord(plan.metadata?.runner) ? plan.metadata.runner : {}
  const wait = isRecord(runner.wait) ? runner.wait : {}
  return typeof wait.days === 'number' && Number.isFinite(wait.days) && wait.days >= 0 ? wait.days : undefined
}

/** The wait's landmark — the "or the world changed" half of a deadline wait
 * (X3). `landmark` and `exit_landmark` are the two spellings the corpus
 * carries (prose `Landmark:` / `Exit landmark:`). */
function waitLandmarkFor(plan: ScaffoldPlan): string | undefined {
  const runner = isRecord(plan.metadata?.runner) ? plan.metadata.runner : {}
  const wait = isRecord(runner.wait) ? runner.wait : {}
  for (const key of ['landmark', 'exit_landmark'] as const) {
    const value = wait[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function readQuestSlug(quest: object): string {
  const slug = (quest as Record<string, unknown>).slug
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error('quest has no slug (required verbatim for the route.complete event payload)')
  }
  return slug
}

// --- SQL fragment builders ---------------------------------------------------

function taskStatusLines(ctx: EmitContext, status: string, planRef: string): string[] {
  return [
    `UPDATE ${ctx.schema}.tasks SET status = '${status}', updated_at = ${UTC_TIMESTAMP_SQL}`,
    `WHERE route_id = '${ctx.routeId}' AND plan_ref = '${sq(planRef)}'`,
  ]
}

/**
 * Event insert against P1's route_events table. Engine-written events carry
 * compile-time ids in their own namespace (`event-eNNN`); store-written
 * events keep the count-derived `event-NNN` convention. Read models page by
 * `ord` (the identity column), so ids only need uniqueness under
 * UNIQUE(route_id, id).
 */
function eventLines(ctx: EmitContext, kind: string, payloadSql: string): string[] {
  return eventLinesWithKindSql(ctx, `'${kind}'`, payloadSql)
}

/**
 * Event insert whose kind is a SQL expression (e.g. a CASE over a decision).
 *
 * Idempotent under node re-execution (B4.5): each engine event node gets a
 * compile-time dedupe key (unique per node, instance-scoped at run time via
 * {sys_instance_id}); a re-executed node re-derives the same key and inserts
 * nothing. The guard lives on a FROM-less SELECT.
 *
 * The id is a compile-time literal in the engine's own namespace
 * (`event-eNNN` — X1): the previous count-derived id raced under parallel
 * branches (two branches reading the same count would both derive the same
 * id and trip UNIQUE(route_id, id), failing the instance). The 'e' prefix
 * keeps engine ids disjoint from the store's count-derived digit ids.
 * Store-written events (bridge outcomes, CLI rejections) leave dedupe_key
 * NULL — they are not engine-replayed.
 */
function eventLinesWithKindSql(ctx: EmitContext, kindSql: string, payloadSql: string): string[] {
  ctx.counters.event += 1
  const ordinal = String(ctx.counters.event).padStart(3, '0')
  const dedupeKey = `{sys_instance_id}:ev-${ordinal}`
  return [
    `INSERT INTO ${ctx.schema}.route_events (id, route_id, kind, payload, created_at, dedupe_key)`,
    `SELECT 'event-e${ordinal}', '${ctx.routeId}', ${kindSql}, ${payloadSql}, ${UTC_TIMESTAMP_SQL}, '${dedupeKey}'`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${ctx.schema}.route_events`,
    `                  WHERE route_id = '${ctx.routeId}' AND dedupe_key = '${dedupeKey}')`,
  ]
}

/** Escape a value for a single-quoted SQL string context. */
function sq(value: string): string {
  return value.replace(/'/g, "''")
}

/** Render a JSON object as a single-quoted SQL literal (keys in insertion order). */
function jsonSqlLiteral(payload: Record<string, string | boolean | number>): string {
  return `'${sq(JSON.stringify(payload))}'`
}

// --- graph emission ----------------------------------------------------------

function emitComment(ctx: EmitContext, text: string): void {
  if (ctx.lines.length > 0) ctx.lines.push('')
  for (const line of text.split('\n')) ctx.lines.push(`  -- ${line}`)
}

function chainPrefix(ctx: EmitContext): string {
  // Every chain element passes through here exactly once — the count feeds
  // the long-chain chunking (MAX_CHAIN_RUN).
  ctx.elements += 1
  return ctx.emittedAny ? '  ~> ' : '  '
}

function emitSqlNode(ctx: EmitContext, bodyLines: readonly string[], comment: string): void {
  ctx.counters.node += 1
  ctx.lines.push(...renderTagged(`n${ctx.counters.node}`, bodyLines, chainPrefix(ctx), comment))
  ctx.emittedAny = true
}

function emitRawNode(ctx: EmitContext, text: string): void {
  ctx.lines.push(`${chainPrefix(ctx)}${text}`)
  ctx.emittedAny = true
}

// NOTE (executed finding, 2026-07-12): df.loop is NOT usable in this graph.
// A loop iteration ends the execution as ContinuedAsNew and the new execution
// starts with FRESH history — every node re-executes from the top (duplicate
// events/dispatches, current_node regression). Retry/re-decide semantics live
// at the signal layer instead: the bridge and `waypoint gate` only signal
// outcomes that advance the graph, and record everything else off-graph.

// NOTE (executed finding, 2026-07-12): every capture MUST reuse the single
// name 'sig'. pg_durable 0.2.4 serializes the accumulated results map into
// each sub-orchestration spawn input with NONDETERMINISTIC key order (Rust
// HashMap), so a graph holding two or more live captures when a race arm or
// parallel branch spawns fails replay with "nondeterministic: schedule
// mismatch" and parks forever (reproduced: two captured branch signals, then
// a deadline-wait race, then any wake). One shared name keeps the map at one
// entry, which serializes identically on every replay. Safe because every
// emitted `$sig` reference immediately follows its own capture in the same
// chain — nothing reads an earlier plan's capture. Re-audit on upgrade.
function nextSignal(_ctx: EmitContext): string {
  return 'sig'
}

/**
 * Dollar-quote a node body with tag `$<base>$`, deterministically extending the
 * tag with 'x' while the node's content — its SQL body plus the header comment
 * carrying the verbatim plan title — contains the candidate tag.
 */
function renderTagged(
  tagBase: string,
  bodyLines: readonly string[],
  prefix: string,
  comment: string,
): string[] {
  const content = `${comment}\n${bodyLines.join('\n')}`
  let tag = `$${tagBase}$`
  while (content.includes(tag)) {
    tag = `${tag.slice(0, -1)}x$`
  }
  const continuationIndent = ' '.repeat(prefix.length + tag.length + 1)
  const rendered = bodyLines.map((line, index) => (index === 0 ? `${prefix}${tag} ${line}` : `${continuationIndent}${line}`))
  rendered[rendered.length - 1] += ` ${tag}`
  return rendered
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
