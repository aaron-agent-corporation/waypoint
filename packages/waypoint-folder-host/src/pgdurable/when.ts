/**
 * X2 (docs/designs/df-operator-coverage.md): the `when:` machine predicate.
 *
 * A plan may carry `metadata.runner.when` — a machine-evaluable SQL predicate
 * the df compiler copies VERBATIM into `df.if(...)`. The plan runs when the
 * predicate is truthy; when falsy the task is recorded done with
 * `{skipped: true}` evidence plus a `route.task.skipped` event and the chain
 * continues. `required_when` is untouched: that stays worker-judged prose.
 *
 * Raw SQL is the one place an author can smuggle an invalid node into the
 * graph, so admission is FAIL CLOSED (operator directive, 2026-07-12). Three
 * walls:
 *  1. this static check — shared by authoring validation and the compiler;
 *  2. the compiler refuses any plan whose predicate has problems;
 *  3. `startDurableRoute` PREPAREs each predicate against the live database
 *     (parse + analysis, no execution) before df.start.
 *
 * Why each rule exists:
 *  - single SELECT, no ';' — predicates observe state; they never change it.
 *  - no '$'   — blocks df result-var substitution ($sig_N) and any dollar-quote
 *               text, so the compiler's node tags can never collide or close early.
 *  - braces only for the X5 start-time variables — anything else is
 *               unspecified engine substitution. Build JSON with
 *               jsonb_build_object.
 *  - no SQL comments — a trailing `--` would swallow the closing dollar-quote
 *               tag the compiler appends on the same line.
 *  - no 'df.' — predicates must not touch the engine (df.cancel/df.signal in a
 *               condition would be a side effect wearing a read's clothes).
 */
/**
 * X5: the start-time variables every durable route carries — usable as
 * `{name}` in when-predicates, which is what makes a predicate portable
 * ({waypoint_schema}) and self-referential ({waypoint_route_id}).
 *
 * Resolution is COMPILE-TIME (substituteStartVariables), not df.setvar.
 * Executed finding (2026-07-12, pg_durable 0.2.4): an instance started with
 * ANY session variables set never completes a df.race — the identical
 * race(wait_for_signal, sleep) graph completes in seconds with no vars and
 * parks forever with them (clearvars after start changes nothing). The
 * values are start-time constants either way, so conversion-time
 * substitution has identical semantics with no engine exposure. df.setvar
 * is quarantined from the start path until an upstream fix — re-audit on
 * any pg_durable upgrade.
 *
 * Values are validated to a conservative charset: raw textual substitution
 * means escaping is a wall, not a convention.
 */
export const DURABLE_START_VARIABLES = [
  'waypoint_schema',
  'waypoint_route_id',
  'waypoint_quest',
  'waypoint_subject_type',
  'waypoint_subject_id',
] as const

export const START_VARIABLE_VALUE_PATTERN = /^[A-Za-z0-9._:-]+$/

const KNOWN_VARIABLE_RE = new RegExp(`\\{(?:${DURABLE_START_VARIABLES.join('|')})\\}`, 'g')

/**
 * Resolve the start-time variables in a predicate. Fail closed twice over:
 * a referenced variable with no provided value refuses to compile, and a
 * value outside the substitution-safe charset refuses too (it lands inside
 * dollar-quoted node SQL and often inside single-quoted strings).
 */
export function substituteStartVariables(sql: string, variables: Record<string, string> | undefined): string {
  return sql.replace(KNOWN_VARIABLE_RE, (token) => {
    const name = token.slice(1, -1)
    const value = variables?.[name]
    if (value === undefined) {
      throw new Error(`predicate references ${token} but no value for it was provided at compile (fail closed)`)
    }
    if (!START_VARIABLE_VALUE_PATTERN.test(value)) {
      throw new Error(
        `start-time variable ${token} has an unsafe value ${JSON.stringify(value)} — substitution is raw text, so values must match ${String(START_VARIABLE_VALUE_PATTERN)} (fail closed)`,
      )
    }
    return value
  })
}

export function whenPredicateProblems(predicate: string): string[] {
  const problems: string[] = []
  const trimmed = predicate.trim()
  if (trimmed.length === 0) {
    problems.push('predicate is empty')
    return problems
  }
  if (!/^select\b/i.test(trimmed)) {
    problems.push('predicate must be a single SELECT statement (read-only)')
  }
  if (trimmed.includes(';')) {
    problems.push("';' is not allowed (single statement only)")
  }
  if (trimmed.includes('$')) {
    problems.push("'$' is not allowed (no result-variable substitution, no dollar quoting)")
  }
  const withoutKnownVariables = trimmed.replace(KNOWN_VARIABLE_RE, '')
  if (withoutKnownVariables.includes('{') || withoutKnownVariables.includes('}')) {
    problems.push(
      `'{' and '}' are allowed only as the start-time variables ${DURABLE_START_VARIABLES.map((name) => `{${name}}`).join(', ')} (anything else is unspecified substitution; build JSON with jsonb_build_object)`,
    )
  }
  if (trimmed.includes('--') || trimmed.includes('/*')) {
    problems.push('SQL comments are not allowed')
  }
  if (/\bdf\s*\./i.test(trimmed)) {
    problems.push("'df.' calls are not allowed (predicates must not touch the engine)")
  }
  return problems
}

/**
 * Read a plan's `when` predicate from scaffold metadata. Fail closed: a `when`
 * key that is present but not a non-empty string is an error, never ignored.
 */
export function whenPredicateFor(planRef: string, metadata: Record<string, unknown> | undefined): string | undefined {
  const runner = metadata?.runner
  if (typeof runner !== 'object' || runner === null || Array.isArray(runner)) return undefined
  if (!('when' in runner)) return undefined
  const when = (runner as Record<string, unknown>).when
  if (typeof when !== 'string' || when.trim().length === 0) {
    throw new Error(`plan '${planRef}' has a non-string or empty when predicate (fail closed)`)
  }
  return when.trim()
}
