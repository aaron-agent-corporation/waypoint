/**
 * Review-check admission (rsc-8vw).
 *
 * A quest plan can declare `Review checks (independent):` in its prose, which
 * compiles to `metadata.runner.review = { independent, checks[] }`. Before this
 * module that block was DECORATIVE: it reached the compiled YAML and the task
 * metadata, and nothing ever read it — the runtime's verdict was process-exit ×
 * report × verify-then-apply(artifacts), review checks included nowhere. So an
 * author could list checks, the lint's `unverifiable-plan` warning would fall
 * silent (it is satisfied by Produces: OR Review checks:), and the run would
 * still just trust the worker. That is exactly the failure the lint's own
 * philosophy names — "a check that cannot fail is a task that cannot be
 * verified."
 *
 * The independence is STRUCTURAL, and the quest graph already arranges it: a
 * review-bearing plan (e.g. an adversarial QC pass) is its own
 * node in its own wave, reviewing the output an EARLIER plan produced. This
 * module does not spawn a second reviewer — the plan IS the independent
 * reviewer. What it enforces is that the reviewer's report carries an itemized,
 * passing verdict for every declared check: each check's verdict rides the
 * report evidence as `review.<check>`, and admission fails closed when any
 * declared check has no verdict or a non-passing one. A worker can no longer
 * report `finished` over a review-bearing plan without showing its work.
 *
 * Fail-closed, exactly like the artifact-contract and deterministic-entrypoint
 * registries: a missing verdict is a failure, not a pass.
 */

/** The plan's declared review, from `metadata.runner.review`. */
export interface ReviewSpec {
  /** Structural independence marker (its own wave, reviewing prior output). */
  readonly independent: boolean
  /** Named checks the reviewer must itemize a passing verdict for. */
  readonly checks: readonly string[]
}

/** Report evidence carries each check's verdict under this key prefix. */
export const REVIEW_EVIDENCE_PREFIX = 'review.'

/** A verdict passes iff its value is `pass` or `pass:<note>` (case-insensitive). */
function isPass(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === 'pass' || v.startsWith('pass:')
}

/**
 * Pull the report's evidence map. The report is the agent's claim row
 * (`{ status, summary, evidence }`); a review verdict that is not in the
 * evidence is not a verdict at all.
 */
function evidenceOf(report: Record<string, unknown> | null): Record<string, string> {
  if (report === null || typeof report.evidence !== 'object' || report.evidence === null) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(report.evidence as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * Judge a review-bearing plan's report against its declared checks. Returns a
 * problem string per check that has no verdict or a non-passing one; an empty
 * array means every declared check was itemized and passed. A `review` with no
 * checks admits vacuously — an empty check list is not a claim.
 */
export function evaluateReviewChecks(review: ReviewSpec, report: Record<string, unknown> | null): string[] {
  const evidence = evidenceOf(report)
  const problems: string[] = []
  for (const check of review.checks) {
    const value = evidence[`${REVIEW_EVIDENCE_PREFIX}${check}`]
    if (value === undefined) {
      problems.push(`check '${check}' has no verdict — the reviewer reported no ${REVIEW_EVIDENCE_PREFIX}${check} evidence`)
    } else if (!isPass(value)) {
      problems.push(`check '${check}' did not pass: reported ${JSON.stringify(value)}`)
    }
  }
  return problems
}

/**
 * The gate-brief admission (Aaron 2026-08-14: "I don't think we should let
 * approvals go to the gate or to a question if there's no plain language
 * summary").
 *
 * A task whose completion opens a human gate must report a plain-language
 * `brief` — the note the gate leads with. Route-115's document-pipeline gate
 * opened over "Waypoint did not leave a plain-language summary of this work",
 * asking an attorney to approve work nobody had described. The brief was
 * designed optional on the theory that the approval card derives everything
 * from the case; the live gate proved the derived layer alone is not enough.
 *
 * Same discipline as the review checks above: the requirement rides the work
 * order (never a trap), and admission fails closed — a finished report with
 * no brief is rejected before anything reaches the case tree, and the retry
 * carries this reason back to the worker verbatim.
 */
export function gateBriefProblem(report: Record<string, unknown> | null): string | null {
  const brief = report?.brief
  if (typeof brief === 'string' && brief.trim() !== '') return null
  return (
    'this task\'s completion opens a human approval and its report carries no "brief" — ' +
    'report again with a brief: one to three plain-language sentences telling the attorney ' +
    'what was done and what they are deciding (no file paths, no system vocabulary)'
  )
}

/**
 * The review contract lines for the work order: the section that tells the
 * reviewing agent HOW to report its verdict, so the enforcement above is a
 * contract the worker was told about, never a trap it could not have known.
 */
export function reviewContractLines(review: ReviewSpec, taskId: string, reportsViaTool = false): string[] {
  // Third medium, same verdicts (see toolClaimReportContract). A worker on a
  // closed tool surface has no `evidence` argument to key — it has `report`'s
  // `review` argument, and the tool applies the prefix itself. Showing it the
  // evidence shape would be the same trap in a new place.
  if (reportsViaTool) {
    return [
      '## Review contract',
      `This plan is an${review.independent ? ' INDEPENDENT' : ''} review. You must itemize a verdict for EVERY check below; a`,
      'missing verdict fails the plan just as a failing one does — silence is not a pass.',
      'Pass them in the `review` argument of the `report` tool, one entry per check, keyed by the check text exactly',
      'as written here and valued "pass: <one-line reason>" or "fail: <one-line reason>". For example:',
      `  {${review.checks.map((check) => ` "${check}": "pass: <reason>"`).join(',')} }`,
      'A verdict written anywhere else — in the summary, in a page — does not count.',
      'Report finished only if every check passes; if any check fails, report the failing verdict(s) and',
      `report status failed. The checks: ${review.checks.join(', ')}.`,
    ]
  }
  return [
    '## Review contract',
    `This plan is an${review.independent ? ' INDEPENDENT' : ''} review. You must itemize a verdict for EVERY check below; a`,
    'missing verdict fails the plan just as a failing one does — silence is not a pass.',
    // Describe the EVIDENCE, not one way of writing it. This used to print a
    // `waypoint tasks report --evidence ...` command line, which no worker can
    // run: the report seam is the claim file on every path (rsc-452), and a
    // tools-only worker has neither a shell nor that CLI. An attempt wrote 26
    // correct pages and was rejected because it put its verdicts in the summary
    // prose — the contract had shown it a command instead of a shape.
    'Report each verdict as an entry in your report\'s `evidence` object, keyed exactly as shown:',
    ...review.checks.map((check) => `  "${REVIEW_EVIDENCE_PREFIX}${check}": "pass|fail: <one-line reason>"`),
    'A verdict written anywhere else — in the summary, in a file — does not count.',
    'Report finished only if every check passes; if any check fails, report the failing verdict(s) and',
    `report status failed. The checks: ${review.checks.join(', ')}.`,
  ]
}
