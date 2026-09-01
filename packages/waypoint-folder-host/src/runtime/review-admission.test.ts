import { describe, expect, it } from 'vitest'

import { evaluateReviewChecks, gateBriefProblem, reviewContractLines, REVIEW_EVIDENCE_PREFIX } from './review-admission.ts'

/**
 * rsc-8vw — the review verdict evaluator. The whole point of the feature is
 * that a review-bearing plan can no longer report `finished` without itemizing
 * a passing verdict per declared check, so these tests concentrate on the
 * FAIL-CLOSED edges: silence, partial coverage, and non-pass values must all be
 * problems, not passes.
 */
describe('evaluateReviewChecks (rsc-8vw)', () => {
  const review = { independent: true, checks: ['visual_source_inspection', 'visit_level_consolidation'] }
  const ev = (evidence: Record<string, string>) => ({ status: 'finished', summary: 's', evidence })

  it('every declared check reported pass -> no problems', () => {
    const report = ev({
      [`${REVIEW_EVIDENCE_PREFIX}visual_source_inspection`]: 'pass',
      [`${REVIEW_EVIDENCE_PREFIX}visit_level_consolidation`]: 'pass: consolidated 14 visits',
    })
    expect(evaluateReviewChecks(review, report)).toEqual([])
  })

  it('a missing verdict is a problem — silence is not a pass', () => {
    const report = ev({ [`${REVIEW_EVIDENCE_PREFIX}visual_source_inspection`]: 'pass' })
    const problems = evaluateReviewChecks(review, report)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('visit_level_consolidation')
    expect(problems[0]).toContain('no verdict')
  })

  it('a failing verdict is a problem, carrying the reported value', () => {
    const report = ev({
      [`${REVIEW_EVIDENCE_PREFIX}visual_source_inspection`]: 'pass',
      [`${REVIEW_EVIDENCE_PREFIX}visit_level_consolidation`]: 'fail: two visits merged into one row',
    })
    const problems = evaluateReviewChecks(review, report)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('did not pass')
    expect(problems[0]).toContain('two visits merged')
  })

  it('a report with no evidence at all fails every check closed', () => {
    expect(evaluateReviewChecks(review, { status: 'finished', summary: 's' })).toHaveLength(2)
    expect(evaluateReviewChecks(review, null)).toHaveLength(2)
  })

  it('"pass" must be the verdict, not merely a substring of it', () => {
    // A value like "passable" or "not passing" must NOT count as a pass — the
    // guard keys on the whole value, not a loose includes().
    for (const sneaky of ['passable', 'not passing', 'passed?', 'failed but passable']) {
      const report = ev({
        [`${REVIEW_EVIDENCE_PREFIX}visual_source_inspection`]: sneaky,
        [`${REVIEW_EVIDENCE_PREFIX}visit_level_consolidation`]: 'pass',
      })
      expect(evaluateReviewChecks(review, report), `"${sneaky}" was accepted as a pass`).toHaveLength(1)
    }
  })

  it('an empty check list admits vacuously — an empty review is not a claim', () => {
    expect(evaluateReviewChecks({ independent: true, checks: [] }, null)).toEqual([])
  })
})

describe('reviewContractLines (rsc-8vw)', () => {
  it('tells the agent the exact evidence key for every check', () => {
    const lines = reviewContractLines({ independent: true, checks: ['alpha', 'beta'] }, 'task-9').join('\n')
    expect(lines).toContain('## Review contract')
    expect(lines).toContain('INDEPENDENT')
    expect(lines).toContain(`"${REVIEW_EVIDENCE_PREFIX}alpha": "pass|fail`)
    expect(lines).toContain(`"${REVIEW_EVIDENCE_PREFIX}beta": "pass|fail`)
    expect(lines).toContain('silence is not a pass')
  })

  it('describes the evidence shape, never a command the worker cannot run', () => {
    // The report seam is the claim file on every path (rsc-452). This used to
    // print a `waypoint tasks report --evidence ...` command line: no worker has
    // that CLI, and a tools-only worker has no shell at all. An attempt wrote
    // 26 correct pages and was rejected for putting its verdicts in prose —
    // it had been shown a command instead of a shape.
    const lines = reviewContractLines({ independent: true, checks: ['alpha'] }, 'task-9').join('\n')
    expect(lines).not.toContain('waypoint tasks report')
    expect(lines).not.toContain('--evidence')
    expect(lines).toContain('`evidence` object')
  })

  it('omits the INDEPENDENT emphasis for a non-independent review', () => {
    const lines = reviewContractLines({ independent: false, checks: ['alpha'] }, 'task-9').join('\n')
    expect(lines).not.toContain('INDEPENDENT')
  })
})

describe('gateBriefProblem (Aaron 2026-08-14)', () => {
  it('a report with a real brief passes', () => {
    expect(gateBriefProblem({ status: 'finished', brief: 'I filed 32 documents; approve that they were read correctly.' })).toBeNull()
  })

  it('a missing, empty, or whitespace brief is a problem', () => {
    expect(gateBriefProblem({ status: 'finished', summary: 'staged' })).toContain('no "brief"')
    expect(gateBriefProblem({ status: 'finished', brief: '' })).toContain('no "brief"')
    expect(gateBriefProblem({ status: 'finished', brief: '   ' })).toContain('no "brief"')
    expect(gateBriefProblem(null)).toContain('no "brief"')
  })

  it('a non-string brief fails closed', () => {
    expect(gateBriefProblem({ status: 'finished', brief: 42 })).toContain('no "brief"')
  })
})
