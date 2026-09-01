import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'
import { extractScaffoldPlans } from '../tasks/store.ts'
import { compileQuestToDurableGraph } from './compiler.ts'
import { DURABLE_START_VARIABLES, START_VARIABLE_VALUE_PATTERN, substituteStartVariables, whenPredicateFor } from './when.ts'

import type { Pool } from 'pg'

/**
 * Route start on the pg_durable engine (P2/B2,
 * docs/designs/p2-waypoint-on-pgdurable.md): compile the quest scaffold to one
 * `SELECT df.start(...)` and hand the route to the engine. From then on the
 * engine advances the route — no polling autopilot; gates/waits park durably
 * and resume via `df.signal`.
 *
 * X5 note: the {waypoint_*} start-time variables are resolved at COMPILE time,
 * never via df.setvar — an executed probe (2026-07-12, pg_durable 0.2.4)
 * showed that an instance started with ANY session variables set never
 * completes a df.race (the identical graph completes in seconds without
 * them). See pgdurable/when.ts. Re-audit on any pg_durable upgrade.
 */
export interface StartDurableRouteInput {
  readonly routeId: string
  readonly quest: { readonly slug: string; readonly scaffolds?: unknown; readonly repeat?: unknown }
}

/** Starts the compiled graph and returns the df instance id (also stored on the route row). */
export async function startDurableRoute(projectRoot: string, input: StartDurableRouteInput): Promise<string> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const variables = await durableStartVariables(pool, schema, input)
  const compiledSql = compileQuestToDurableGraph({
    routeId: input.routeId,
    schema,
    quest: input.quest,
    variables,
  })
  // The compiler's static admission passed (or it would have thrown above);
  // now prove each when predicate against the live database before anything
  // starts — a predicate that cannot parse must never become a running route.
  await assertWhenPredicatesParse(pool, input, variables)

  let result
  try {
    result = await pool.query(compiledSql)
  } catch (error) {
    // The operator's signal that the pg_durable extension is missing or the
    // role lacks df usage — surface the raw pg message, don't swallow it.
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `df.start failed for route ${input.routeId} (is the pg_durable extension installed and the role granted via df.grant_usage?): ${message}`,
    )
  }

  const firstRow = result.rows[0] as Record<string, unknown> | undefined
  const instanceId = firstRow === undefined ? undefined : Object.values(firstRow)[0]
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    throw new Error(`df.start returned no instance id for route ${input.routeId}`)
  }

  await pool.query(`UPDATE ${quoteIdent(schema)}.routes SET instance_id = $2 WHERE id = $1`, [
    input.routeId,
    instanceId,
  ])
  return instanceId
}

/**
 * X5: the start-time variable set for a route — schema, route id, quest, and
 * the route row's subject. Fail closed on values outside the substitution-
 * safe charset: raw textual substitution into node SQL means a quote or
 * brace in a value is an injection, not data.
 */
async function durableStartVariables(
  pool: Pool,
  schema: string,
  input: StartDurableRouteInput,
): Promise<Record<string, string>> {
  const result = await pool.query(`SELECT subject FROM ${quoteIdent(schema)}.routes WHERE id = $1`, [input.routeId])
  const subject = (result.rows[0] as { subject?: unknown } | undefined)?.subject
  const subjectRecord =
    typeof subject === 'object' && subject !== null && !Array.isArray(subject) ? (subject as Record<string, unknown>) : {}
  const values: Record<string, string> = {
    waypoint_schema: schema,
    waypoint_route_id: input.routeId,
    waypoint_quest: input.quest.slug,
    waypoint_subject_type: typeof subjectRecord.type === 'string' ? subjectRecord.type : '',
    waypoint_subject_id: typeof subjectRecord.id === 'string' ? subjectRecord.id : '',
  }
  for (const name of DURABLE_START_VARIABLES) {
    const value = values[name]
    if (typeof value !== 'string' || !START_VARIABLE_VALUE_PATTERN.test(value)) {
      throw new Error(
        `start-time variable ${name} has an unsafe value ${JSON.stringify(value)} — substitution is raw text, so values must match ${String(START_VARIABLE_VALUE_PATTERN)} (fail closed, route not started)`,
      )
    }
  }
  return values
}

/**
 * X2 admission, wall three (fail closed): PREPARE each `when:` predicate
 * against the live database — full parse + analysis (tables and columns must
 * resolve) with NO execution, so a side-effecting function in a predicate
 * still cannot run here. The static admission rules (pgdurable/when.ts) have
 * already banned ';', so appending DEALLOCATE in the same multi-statement
 * string is safe; the implicit transaction removes the prepared statement
 * whether the pair commits or aborts, leaving no session state on the pool.
 *
 * X5: the probe substitutes the start-time variables exactly as the compiler
 * does, so it validates the SQL that will actually run — a predicate
 * referencing `{waypoint_schema}` PREPAREs against the real schema.
 */
async function assertWhenPredicatesParse(
  pool: Pool,
  input: StartDurableRouteInput,
  variables: Record<string, string>,
): Promise<void> {
  for (const plan of extractScaffoldPlans(input.quest.scaffolds)) {
    const when = whenPredicateFor(plan.plan_ref, plan.metadata)
    if (when === undefined) continue
    const substituted = substituteStartVariables(when, variables)
    try {
      await pool.query(`PREPARE __spine_when_probe AS ${substituted}; DEALLOCATE __spine_when_probe;`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `when predicate on plan '${plan.plan_ref}' does not parse against the database (fail closed, route not started): ${message}`,
      )
    }
  }
}
