import { describe, expect, it } from 'vitest'

import { accountRefusal } from './lane-health.ts'

describe('telling an account refusal from a failed task', () => {
  it('recognises the refusal that killed the medical-layer extraction', () => {
    const refusal = accountRefusal({
      stderr:
        "error: failed to run prompt: provider.api_error: 403 You've reached your usage limit for this " +
        'billing cycle. Your quota will be refreshed in the next cycle.\nSee log: /Users/x/logs/kimi.log',
    })

    expect(refusal).toContain("reached your usage limit for this billing cycle")
    // The sentence, not the whole log — the operator reads this in a notice.
    expect(refusal).not.toContain('See log:')
  })

  it.each([
    ['credit balance is too low to run this request'],
    ['429 Too Many Requests: rate limit exceeded'],
    ['insufficient_quota: you have run out of credits'],
    ['401 Unauthorized — your session has expired'],
    ['Please sign in again to continue'],
    ['oauth token expired; refresh token is invalid'],
  ])('recognises %s', (line) => {
    expect(accountRefusal({ stderr: line })).not.toBeNull()
  })

  it.each([
    ['the recipe wrote no artifacts and the contract failed'],
    ['ENOENT: no such file or directory'],
    ['exhausted: process group killed after the 1800000ms budget'],
    ["unknown command 'kimi-code/k3'. See 'kimi --help'."],
    ['the demand figure is an attorney decision and was not supplied'],
  ])('leaves an ordinary failure alone: %s', (line) => {
    // A misread here re-queues a genuinely broken task around every lane and
    // burns eight subscriptions on the same doomed attempt.
    expect(accountRefusal({ stderr: line })).toBeNull()
  })

  it('says nothing about an attempt that said nothing', () => {
    expect(accountRefusal({})).toBeNull()
    expect(accountRefusal({ stderr: '   ' })).toBeNull()
  })

  it('reads the close reason and the error too, not just stderr', () => {
    expect(accountRefusal({ error: 'Anthropic API: credit balance is too low' })).not.toBeNull()
    expect(accountRefusal({ close_reason: 'process exited 1: quota exceeded' })).not.toBeNull()
  })
})

/**
 * A revoked token is an account refusal, exactly like an expired one
 * (in vivo 2026-08-08).
 *
 * A Claude sub answered `401 OAuth access token has been revoked.` It matched
 * none of the patterns, so the dispatch was recorded as a failed TASK and the
 * route terminated — for a reason that had nothing to do with the work, with
 * two other healthy accounts sitting unused. The same account, worded
 * `OAuth session expired`, did match and would have re-queued.
 */
describe('an account refusal is recognised however the provider words it', () => {
  const refusals = [
    'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
    'Failed to authenticate: OAuth session expired and could not be refreshed',
    'Error: your token was revoked, please sign in again',
    'API Error: 403 token is deauthorized',
    // The 2026-08-15 wording that burned a batch on one exhausted
    // subscription while four other providers' lanes sat idle (route-007).
    "You've hit your session limit · resets 3:10pm (America/New_York)",
    "You've hit your weekly limit · resets Tuesday",
    'Session limit reached ∙ resets 6pm',
  ]
  for (const stdout of refusals) {
    it(`re-queues on: ${stdout.slice(0, 52)}…`, () => {
      expect(accountRefusal({ stdout })).not.toBeNull()
    })
  }

  // The narrowness that makes this safe: an ordinary broken task must NOT be
  // re-queued around every lane in the pool, burning each account on the same
  // doomed attempt.
  const taskFailures = [
    'TypeError: cannot read property of undefined',
    'the report contract is mandatory — no claim was filed',
    'ERROR: "1" is not an approved cite record id',
    'process exited 1',
  ]
  for (const stdout of taskFailures) {
    it(`does NOT re-queue on: ${stdout.slice(0, 46)}…`, () => {
      expect(accountRefusal({ stdout })).toBeNull()
    })
  }
})
