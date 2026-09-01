import { describe, expect, it } from 'vitest'

import { CORDIS_INFRA_REFUSAL_PREFIX } from '../runtime/cordis-jailed-runtime.ts'
import { decideAutoRetry } from './bridge.ts'

const NO_REPORT = 'process exited 0 but the attempt has no report — the worker never called its `report` tool'
const JAIL_REFUSED = 'seatbelt jail refused the attempt (no spawn)'

describe('bounded auto re-dispatch (rsc-m23.6)', () => {
  it('retries the failure that stalled the fan-out run', () => {
    // vance-fanout route-001: an arm wrote both its pages and all its
    // close-outs, then ended without calling `report`. The work was fine; the
    // route sat dead for want of one retry.
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: NO_REPORT,
      previousCloseReason: null,
    })

    expect(decision.retry).toBe(true)
    expect(decision.reason).toContain('attempt 1/3')
  })

  it('stops when the attempts are spent, and says so for the human', () => {
    const decision = decideAutoRetry({ attempts: 3, maxAttempts: 3, closeReason: NO_REPORT, previousCloseReason: JAIL_REFUSED })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('parked for a human')
  })

  it('stops on the SAME failure twice, without spending the remaining attempts', () => {
    // A retry is a bet that the failure was incidental. An identical failure is
    // that bet losing — burning attempt 3 on it only delays the human.
    const decision = decideAutoRetry({ attempts: 2, maxAttempts: 5, closeReason: JAIL_REFUSED, previousCloseReason: JAIL_REFUSED })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('same way twice')
  })

  it('retries when the second failure is a DIFFERENT one', () => {
    const decision = decideAutoRetry({ attempts: 2, maxAttempts: 3, closeReason: NO_REPORT, previousCloseReason: JAIL_REFUSED })

    expect(decision.retry).toBe(true)
  })

  it('is disabled by max_attempts of 1, which is how an operator turns it off', () => {
    const decision = decideAutoRetry({ attempts: 1, maxAttempts: 1, closeReason: NO_REPORT, previousCloseReason: null })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('disabled')
  })

  it("never retries a deliberate 'failed' report — a verdict is not a crash", () => {
    // route-349 (2026-08-15): the pipeline QC reviewed 231 documents and
    // reported NOT-READY. The bridge re-dispatched the QC — same staging,
    // same verdict, half an hour for nothing. A verdict fails the route so
    // the route-level rework (which changes the inputs) is the retry.
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: "agent reported 'failed': Independent QC of all 231 staged documents is complete.",
      previousCloseReason: null,
    })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('verdict')
  })

  it("still retries a crash even when a report says 'failed' alongside a bad exit", () => {
    // "process exited 1 (agent reported 'failed' — exit status wins)" is a
    // crash with commentary, not a clean verdict — the prefix decides.
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: "process exited 1 (agent reported 'failed' — exit status wins)",
      previousCloseReason: null,
    })

    expect(decision.retry).toBe(true)
  })

  it('does not treat two unknown close reasons as the same failure', () => {
    // Null is "we do not know why", not "the same reason as last time" — the
    // same-reason brake must never fire on absence of information.
    const decision = decideAutoRetry({ attempts: 1, maxAttempts: 3, closeReason: null, previousCloseReason: null })

    expect(decision.retry).toBe(true)
  })
})

describe('infra refusals are backpressure, not task attempts (route-014)', () => {
  const INFRA = `${CORDIS_INFRA_REFUSAL_PREFIX}: The operation was aborted due to timeout`

  it('re-queues an infra refusal without charging an attempt, even at the attempt ceiling', () => {
    // route-014: attempts were spent on 30s Sprites-API timeouts while the
    // fleet recycled two sick placements — no worker ever ran.
    const decision = decideAutoRetry({
      attempts: 3,
      maxAttempts: 3,
      closeReason: INFRA,
      previousCloseReason: INFRA,
      consecutiveInfraRefusals: 3,
    })

    expect(decision.retry).toBe(true)
    expect(decision.reason).toContain('without charging a task attempt')
  })

  it('never trips the same-reason brake on two identical infra refusals', () => {
    // Identical refusals are EXPECTED while the fleet is busy or healing —
    // the brake exists for deterministic task failures, and this is neither.
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: INFRA,
      previousCloseReason: INFRA,
      consecutiveInfraRefusals: 2,
    })

    expect(decision.retry).toBe(true)
    expect(decision.reason).not.toContain('same way twice')
  })

  it('parks for a human after the consecutive cap — a permanently sick fleet must be visible', () => {
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: INFRA,
      previousCloseReason: INFRA,
      consecutiveInfraRefusals: 10,
    })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('infrastructure, not the task')
  })

  it('a real failure after an infra streak still spends attempts normally', () => {
    const decision = decideAutoRetry({
      attempts: 2,
      maxAttempts: 3,
      closeReason: 'jailed cordis worker exited 1: stream went quiet',
      previousCloseReason: INFRA,
      consecutiveInfraRefusals: 0,
    })

    expect(decision.retry).toBe(true)
    expect(decision.reason).toContain('attempt 2/3')
  })

  it('never re-queues on a CANCELLED route — a cancel is the final word, even over an infra refusal', () => {
    // route-015: the requeue path INSERTed a fresh dispatch and flipped the
    // cancelled route back to 'active', so the dead run churned on for
    // minutes, holding both lanes against the operator's probes.
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 3,
      closeReason: INFRA,
      previousCloseReason: null,
      consecutiveInfraRefusals: 1,
      routeStatus: 'cancelled',
    })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('cancelled by the operator')
  })

  it('still respects the operator disable — max_attempts of 1 turns the whole ladder off', () => {
    const decision = decideAutoRetry({
      attempts: 1,
      maxAttempts: 1,
      closeReason: INFRA,
      previousCloseReason: null,
      consecutiveInfraRefusals: 1,
    })

    expect(decision.retry).toBe(false)
    expect(decision.reason).toContain('disabled')
  })
})
