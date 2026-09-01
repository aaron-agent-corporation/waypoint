import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LANE_CREDENTIAL_HEALTH_FILE,
  clearLaneCredentialRefusal,
  laneCredentialHold,
  laneCredentialRefusalFromCloseReason,
  laneHomeCredentialFingerprint,
  laneQuotaHoldFromCloseReason,
  readLaneCredentialHealth,
  recordLaneCredentialRefusal,
} from './lane-credential-health.ts'

const envFor = (root: string): NodeJS.ProcessEnv => ({ WAYPOINT_SUBS_ROOT: root }) as NodeJS.ProcessEnv

describe('lane credential health', () => {
  it('records a refusal, holds the lane out, and clears on re-auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const env = envFor(root)
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)

    recordLaneCredentialRefusal('sub:codex-a', 'sign-in has lapsed', { env })
    const health = readLaneCredentialHealth(env)
    expect(health.refused.size).toBe(1)
    expect(laneCredentialHold('sub:codex-a', health)).toMatch(/sign-in has lapsed.*Subscriptions/)
    expect(laneCredentialHold('sub:codex-b', health)).toBeNull()

    clearLaneCredentialRefusal('sub:codex-a', { env })
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
  })

  it('is idempotent per lane and keeps other lanes untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const env = envFor(root)
    recordLaneCredentialRefusal('sub:codex-a', 'first', { env })
    recordLaneCredentialRefusal('sub:codex-a', 'second', { env })
    recordLaneCredentialRefusal('sub:codex-b', 'other', { env })
    const health = readLaneCredentialHealth(env)
    expect(health.refused.size).toBe(2)
    expect(health.refused.get('sub:codex-a')?.message).toBe('second')
    clearLaneCredentialRefusal('sub:codex-a', { env })
    expect([...readLaneCredentialHealth(env).refused.keys()]).toEqual(['sub:codex-b'])
  })

  it('a re-auth self-clears the hold — otherwise the gate blocks the dispatch that would prove it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const env = envFor(root)
    const home = join(root, 'codex-a')
    await mkdir(home, { recursive: true })
    const writeTokens = (access: string, refresh: string) =>
      writeFile(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: access, refresh_token: refresh } }), 'utf8')

    await writeTokens('lapsed-access', 'lapsed-refresh')
    recordLaneCredentialRefusal('sub:codex-a', 'sign-in has lapsed', { env, homePath: home })
    const held = readLaneCredentialHealth(env)
    // Still the same credential → still held.
    expect(laneCredentialHold('sub:codex-a', held, home)).toMatch(/sign-in has lapsed/)
    // The fingerprint is a hash, never the token material itself.
    const recorded = held.refused.get('sub:codex-a')!.credential_fingerprint
    expect(recorded).toMatch(/^[0-9a-f]{16}$/)
    expect(recorded).not.toContain('lapsed')

    // Aaron re-auths through the Console: new tokens, same lane.
    await writeTokens('fresh-access', 'fresh-refresh')
    expect(laneCredentialHold('sub:codex-a', readLaneCredentialHealth(env), home)).toBeNull()
    // Without a home path the caller still sees the recorded hold.
    expect(laneCredentialHold('sub:codex-a', readLaneCredentialHealth(env))).toMatch(/sign-in has lapsed/)
  })

  it('fingerprints only token material, and an unreadable home never matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const home = join(root, 'codex-a')
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: 'a', refresh_token: 'b' } }), 'utf8')
    const first = laneHomeCredentialFingerprint(home)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    // Unrelated Console fields do not move the fingerprint.
    await writeFile(
      join(home, 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: null, last_refresh: 'x', tokens: { access_token: 'a', refresh_token: 'b' } }),
      'utf8',
    )
    expect(laneHomeCredentialFingerprint(home)).toBe(first)
    expect(laneHomeCredentialFingerprint(join(root, 'absent'))).toBe('')
  })

  it('fails OPEN on a corrupt record — a bad file must never shrink the pool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const env = envFor(root)
    await writeFile(join(root, LANE_CREDENTIAL_HEALTH_FILE), '{not json', 'utf8')
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
    await writeFile(join(root, LANE_CREDENTIAL_HEALTH_FILE), JSON.stringify({ refused: 'nope' }), 'utf8')
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
  })

  it('clearing an unheld lane is a no-op, and an absent root reads clean', async () => {
    const env = envFor(join(tmpdir(), 'lane-health-absent-root'))
    expect(() => clearLaneCredentialRefusal('sub:codex-a', { env })).not.toThrow()
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
  })
})

describe('in-guest credential refusal classification (route-006)', () => {
  it('matches both shapes the same server-side refusal is known to wear', () => {
    // Verbatim from route-006's guests (the Bun bundle's costume) …
    expect(
      laneCredentialRefusalFromCloseReason(
        'jailed cordis worker exited 1: cordis worker: failed: cordis loop error: ' +
          'model openai-codex/gpt-5.3-codex-spark failed: OAuth refresh failed for openai-codex',
      ),
    ).toMatch(/refused the lane token in-guest/)
    // … and verbatim from the same kernel run host-side (the server's own body).
    expect(
      laneCredentialRefusalFromCloseReason(
        'cordis loop error: model openai-codex/gpt-5.3-codex-spark failed: ' +
          'Provided authentication token is expired.',
      ),
    ).toMatch(/provided authentication token is expired/)
  })

  it('a plan-gated account is a lane-level refusal too — route-007, verbatim', () => {
    const hold = laneCredentialRefusalFromCloseReason(
      'jailed cordis worker exited 1: cordis worker: failed: cordis loop error: ' +
        'model openai-codex/gpt-5.3-codex-spark failed: ' +
        '{"detail":"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account."}',
    )
    expect(hold).toMatch(/plan does not serve codex worker models/)
    // The sign-in is VALID here — the guidance must not send the operator
    // into a re-auth loop.
    expect(hold).toMatch(/paid/)
  })

  it('a quota refusal parses the provider retry time and holds until then plus margin', () => {
    const now = () => new Date('2026-08-30T18:28:00Z')
    const quota = laneQuotaHoldFromCloseReason(
      'jailed cordis worker exited 1: cordis worker: failed: cordis loop error: ' +
        'model openai-codex/gpt-5.3-codex-spark failed: You have hit your ChatGPT usage limit ' +
        '(prolite plan). Try again in ~32 min.',
      now,
    )
    expect(quota).not.toBeNull()
    // ~32 min stated + 5 min margin.
    expect(quota!.heldUntil.toISOString()).toBe('2026-08-30T19:05:00.000Z')
    expect(quota!.message).toMatch(/heals by waiting/)
    expect(quota!.message).toMatch(/~32 min/)
    // No stated time → the fallback window.
    const vague = laneQuotaHoldFromCloseReason('You have hit your ChatGPT usage limit.', now)
    expect(vague!.heldUntil.toISOString()).toBe('2026-08-30T19:03:00.000Z')
    // Not a quota message → null.
    expect(laneQuotaHoldFromCloseReason('WebSocket error', now)).toBeNull()
  })

  it('a held_until hold expires on its own — quota heals by waiting, not re-auth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lane-health-'))
    const env = envFor(root)
    recordLaneCredentialRefusal('sub:codex-a', 'quota spent', {
      env,
      heldUntil: new Date('2026-08-30T19:05:00Z'),
    })
    const health = readLaneCredentialHealth(env)
    const before = () => new Date('2026-08-30T19:00:00Z')
    const after = () => new Date('2026-08-30T19:05:01Z')
    expect(laneCredentialHold('sub:codex-a', health, undefined, before)).toMatch(/quota spent/)
    expect(laneCredentialHold('sub:codex-a', health, undefined, after)).toBeNull()
  })

  it('never matches transport deaths, model errors, or plain task failures', () => {
    for (const reason of [
      'jailed cordis worker exited 1: model openai-codex/x failed: WebSocket error (stream died on all 3 attempts)',
      'model openai-codex/x failed: Codex SSE response headers timed out after 15000ms',
      'model openai-codex/x stream went quiet for 45000ms between events',
      "jailed cordis worker reported 'failed': the run ended with no claim filed — even after the report nudge",
      'result pull failed after enter: tar exited 1',
      '',
    ]) {
      expect(laneCredentialRefusalFromCloseReason(reason)).toBeNull()
    }
  })

  it('matches OpenRouter key refusals; rate limits stay transient', () => {
    expect(
      laneCredentialRefusalFromCloseReason('cordis loop error: model openrouter/z-ai/glm-4.6 failed: Invalid API key'),
    ).toMatch(/refused the lane API key/)
    expect(
      laneCredentialRefusalFromCloseReason('model openrouter/x failed: No auth credentials found'),
    ).toMatch(/refused the lane API key/)
    expect(
      laneCredentialRefusalFromCloseReason('model openrouter/x failed: Rate limit exceeded (429)'),
    ).toBeNull()
  })

  it('OpenRouter insufficient-credits is a time-bounded quota hold (~30 min)', () => {
    const now = () => new Date('2026-08-30T22:00:00.000Z')
    const hold = laneQuotaHoldFromCloseReason(
      'cordis loop error: model openrouter/z-ai/glm-4.6 failed: 402 Insufficient credits. Add more using https://openrouter.ai/credits',
      now,
    )
    expect(hold).not.toBeNull()
    expect(hold!.message).toMatch(/out of credits/)
    expect(hold!.heldUntil.toISOString()).toBe('2026-08-30T22:30:00.000Z')
    expect(
      laneQuotaHoldFromCloseReason('model openrouter/x failed: Rate limit exceeded (429)', now),
    ).toBeNull()
  })
})
