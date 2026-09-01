import { describe, expect, it } from 'vitest'

import { spriteTransportDeathFromCloseReason } from './sprite-recycle.ts'

describe('spriteTransportDeathFromCloseReason', () => {
  it('matches the route-009 exhaustion close reason verbatim', () => {
    const verdict = spriteTransportDeathFromCloseReason(
      'cordis loop error: model openai-codex/gpt-5.3-codex-spark stream went quiet for 45000ms between events (stream died on all 5 attempts)',
    )
    expect(verdict).toMatch(/fresh placement/)
  })

  it('matches any transport flavor carrying the exhaustion suffix', () => {
    const verdict = spriteTransportDeathFromCloseReason(
      'jailed cordis worker exited 1: model openai-codex/x failed: Codex SSE response headers timed out after 15000ms (stream died on all 3 attempts)',
    )
    expect(verdict).not.toBeNull()
  })

  it('never fires on account refusals, single transport deaths, or other failures', () => {
    const never: Array<string | null | undefined> = [
      // Quota — holds the lane with held_until, heals by waiting.
      'cordis loop error: model openai-codex/x failed: You have hit your ChatGPT usage limit (prolite plan). Try again in ~138 min.',
      // Credential refusals — hold the lane, fingerprint self-clears.
      'cordis loop error: model openai-codex/x failed: Provided authentication token is expired.',
      'cordis loop error: OAuth refresh failed for openai-codex',
      'cordis loop error: model x is not supported when using Codex with a ChatGPT account.',
      // A single transport death is retried inline — never a recycle.
      'model openai-codex/x turn attempt 1/5 died in transport (stream went quiet for 45000ms between events) — retrying',
      // Worker crashes are the worker's, not the placement's.
      'jailed cordis worker exited 1: Cannot find module /opt/cordis-worker/cordis-worker.mjs',
      '',
      null,
      undefined,
    ]
    for (const reason of never) {
      expect(spriteTransportDeathFromCloseReason(reason)).toBeNull()
    }
  })
})
