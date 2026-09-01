import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createInProcessOauthLaneLocks } from './oauth-lane-lock.ts'
import {
  anthropicWorkerLaneRefusal,
  createCordisLanePicker,
  envInjectForSubscriptionHome,
  listSubscriptionHomes,
  oauthLaneIdForSubscription,
  pickFreeOauthLane,
  stableOauthSandboxName,
  workerLaneConsoleProviderForPiProvider,
} from './oauth-lane-resolve.ts'

function fakeJwt(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url')
  return `x.${payload}.y`
}

async function subsFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lane-subs-'))
  // Signed-in codex lane with a decodable account email.
  await mkdir(join(root, 'codex-worker-a'), { recursive: true })
  await writeFile(
    join(root, 'codex-worker-a', 'auth.json'),
    JSON.stringify({ tokens: { id_token: fakeJwt('Worker-A@agents.example.com') } }),
    'utf8',
  )
  // Second signed-in codex lane.
  await mkdir(join(root, 'codex-worker-b'), { recursive: true })
  await writeFile(
    join(root, 'codex-worker-b', 'auth.json'),
    JSON.stringify({ tokens: { id_token: fakeJwt('worker-b@agents.example.com') } }),
    'utf8',
  )
  // Husk: auth.json present but no token material — signed OUT.
  await mkdir(join(root, 'codex-husk'), { recursive: true })
  await writeFile(join(root, 'codex-husk', 'auth.json'), JSON.stringify({ tokens: {} }), 'utf8')
  // Signed-in kimi lane.
  await mkdir(join(root, 'kimi-worker', 'credentials'), { recursive: true })
  await writeFile(
    join(root, 'kimi-worker', 'credentials', 'kimi-code.json'),
    JSON.stringify({ refresh_token: 'r' }),
    'utf8',
  )
  // A claude home must never become a worker lane (delta 1).
  await mkdir(join(root, 'claude-brainish'), { recursive: true })
  await writeFile(
    join(root, 'claude-brainish', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 't' } }),
    'utf8',
  )
  return root
}

describe('oauth lane inventory', () => {
  it('lists worker homes with signed-in state and account email; claude homes never appear', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    expect(homes.map((h) => h.id)).toEqual(['codex-husk', 'codex-worker-a', 'codex-worker-b', 'kimi-worker'])
    const byId = new Map(homes.map((h) => [h.id, h]))
    expect(byId.get('codex-worker-a')).toMatchObject({
      provider: 'codex',
      signedIn: true,
      email: 'worker-a@agents.example.com',
    })
    expect(byId.get('codex-husk')).toMatchObject({ signedIn: false, email: null })
    expect(byId.get('kimi-worker')).toMatchObject({ provider: 'kimi', signedIn: true, email: null })
  })

  it('maps pi providers to worker lanes; anthropic and claude refuse via the item-53 ruling', () => {
    expect(workerLaneConsoleProviderForPiProvider('openai-codex')).toBe('codex')
    expect(workerLaneConsoleProviderForPiProvider('moonshot')).toBe('kimi')
    expect(workerLaneConsoleProviderForPiProvider('xai')).toBe('grok')
    expect(workerLaneConsoleProviderForPiProvider('anthropic')).toBeNull()
    expect(anthropicWorkerLaneRefusal('anthropic')).toMatch(/worker lane/i)
    expect(anthropicWorkerLaneRefusal('Claude')).toMatch(/worker lane/i)
    expect(anthropicWorkerLaneRefusal('openai-codex')).toBeUndefined()
  })

  it('derives lane ids, env inject, and email-free sprite names', () => {
    expect(oauthLaneIdForSubscription('codex-worker-a')).toBe('sub:codex-worker-a')
    expect(oauthLaneIdForSubscription('sub:codex-worker-a')).toBe('sub:codex-worker-a')
    expect(envInjectForSubscriptionHome('codex', '/x')).toEqual({ CODEX_HOME: '/x' })
    expect(envInjectForSubscriptionHome('grok', '/y')).toEqual({ GROK_HOME: '/y' })
    const name = stableOauthSandboxName('sub:codex-worker-a', 'codex')
    expect(name).toMatch(/^oauth-codex-[0-9a-f]{8}$/)
    expect(name).not.toContain('@')
    // Same preimage as Waypoint: stable across processes and products.
    expect(stableOauthSandboxName('sub:codex-worker-a', 'codex')).toBe(name)
  })
})

describe('pickFreeOauthLane', () => {
  it('refuses anthropic/claude before touching any lock or inventory', async () => {
    const locks = createInProcessOauthLaneLocks()
    for (const provider of ['anthropic', 'claude']) {
      const pick = await pickFreeOauthLane({
        piProvider: provider,
        tryAcquire: locks.tryAcquire,
          homes: [],
      })
      expect(pick.ok).toBe(false)
      if (!pick.ok) expect(pick.reason).toMatch(/worker lane/i)
    }
  })

  it('prefers a free lane, alternates under contention, and blocks when all are busy', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()

    const first = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.reason)
    expect(first.lane.subscriptionId).toBe('codex-worker-a')
    expect(first.lane.envInject).toEqual({ CODEX_HOME: join(root, 'codex-worker-a') })

    // Lane A held → the second pick lands on B (free-lane preference).
    const second = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    expect(second.lane.subscriptionId).toBe('codex-worker-b')

    // Both held → the third pick waits for WHICHEVER lane frees first. Lane B
    // (not the sorted head) releases — under the old block-on-first-candidate
    // behavior this pick would sit on A's lock forever while B idled, which is
    // exactly how route-008 put 9 of 10 dispatches on one lane.
    let settled = false
    const third = pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    }).then((pick) => {
      settled = true
      return pick
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(settled).toBe(false)
    await second.lane.lock.release()
    const blocked = await third
    expect(blocked.ok).toBe(true)
    if (!blocked.ok) throw new Error(blocked.reason)
    expect(blocked.lane.subscriptionId).toBe('codex-worker-b')
    expect(blocked.lane.queue_wait_ms).toBeGreaterThan(0)
    await blocked.lane.lock.release()
    await first.lane.lock.release()
  })

  it('an all-busy wait past the limit refuses loudly instead of hanging', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const a = await locks.tryAcquire('sub:codex-worker-a')
    const b = await locks.tryAcquire('sub:codex-worker-b')
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      waitMs: 20,
      noticeMs: 5,
      onNotice: () => {},
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toMatch(/stayed lock-held/)
    expect(pick.reason).toMatch(/pg_locks/)
    await a!.release()
    await b!.release()
  })

  it('holds brain-reserved lanes out of the pool, and says so when nothing is left', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const reserve = { emails: new Set(['worker-a@agents.example.com']) }

    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      reserve,
    })
    expect(pick.ok).toBe(true)
    if (!pick.ok) throw new Error(pick.reason)
    // A is reserved for the brain — B is the only candidate.
    expect(pick.lane.subscriptionId).toBe('codex-worker-b')
    await pick.lane.lock.release()

    const none = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      reserve: { emails: new Set(['worker-a@agents.example.com', 'worker-b@agents.example.com']) },
    })
    expect(none.ok).toBe(false)
    if (!none.ok) {
      expect(none.reason).toContain('held out')
      expect(none.reason).toContain("serving Waypoint's brain")
    }
  })

  it('fails loud with zero signed-in lanes and on unmapped providers', async () => {
    const locks = createInProcessOauthLaneLocks()
    const none = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes: [],
    })
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reason).toContain("no available 'codex' worker lane")

    const unmapped = await pickFreeOauthLane({
      piProvider: 'mistral',
      tryAcquire: locks.tryAcquire,
      homes: [],
    })
    expect(unmapped.ok).toBe(false)
    if (!unmapped.ok) expect(unmapped.reason).toContain('no worker-lane subscription mapping')
  })
})

describe('capability holds: a lane Waypoint cannot broker is never offered', () => {
  it('refuses a signed-in grok lane at the picker, not at dispatch', async () => {
    const root = await subsFixture()
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'xai',
      tryAcquire: locks.tryAcquire,
      homes: listSubscriptionHomes({ root }),
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toMatch(/cannot broker a 'grok' lane credential yet/)
    expect(pick.reason).toMatch(/however it is signed in/)
  })

  it("holds out a family the brain is on but the registry cannot name", async () => {
    const root = await subsFixture()
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes: listSubscriptionHomes({ root }),
      reserve: { emails: new Set(), unnamedFamilies: new Set(['openai-codex']) },
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toMatch(/does not name which account/)
  })
})

describe('dedicated-accounts policy: a contested account is not a worker lane', () => {
  /** An access token that names the account, the way codex issues them. */
  function accountToken(accountId: string): string {
    const claims = { 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }
    return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
  }

  async function contestedFixture(): Promise<{ root: string; account: string }> {
    const root = await mkdtemp(join(tmpdir(), 'lane-contested-'))
    const account = 'acct-shared-with-another-tool'
    await mkdir(join(root, 'codex-worker-a'), { recursive: true })
    await writeFile(
      join(root, 'codex-worker-a', 'auth.json'),
      JSON.stringify({ tokens: { access_token: accountToken(account), id_token: fakeJwt('a@agents.example.com') } }),
      'utf8',
    )
    await mkdir(join(root, 'codex-worker-b'), { recursive: true })
    await writeFile(
      join(root, 'codex-worker-b', 'auth.json'),
      JSON.stringify({ tokens: { access_token: accountToken('acct-ours-alone'), id_token: fakeJwt('b@agents.example.com') } }),
      'utf8',
    )
    return { root, account }
  }

  it('skips the contested lane and serves the dedicated one', async () => {
    const { root, account } = await contestedFixture()
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes: listSubscriptionHomes({ root }),
      foreignAccounts: new Map([[account, '/elsewhere/codex/auth.json']]),
    })
    expect(pick.ok).toBe(true)
    if (!pick.ok) throw new Error(pick.reason)
    expect(pick.lane.subscriptionId).toBe('codex-worker-b')
    await pick.lane.lock.release()
  })

  it('names the policy when every signed-in lane is contested', async () => {
    const { root, account } = await contestedFixture()
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes: listSubscriptionHomes({ root }),
      foreignAccounts: new Map([
        [account, '/elsewhere/codex/auth.json'],
        ['acct-ours-alone', '/elsewhere/other/auth.json'],
      ]),
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toContain('2 signed-in lane(s) are held out')
    expect(pick.reason).toMatch(/also signed in at \/elsewhere\/codex\/auth\.json/)
  })
})

describe('credential-refused lanes are held out of the pool (item 54)', () => {
  const refusedHealth = (laneIds: string[]) => ({
    refused: new Map(
      laneIds.map((id) => [
        id,
        { lane_id: id, message: 'sign-in has lapsed', recorded_at: '2026-08-29T00:00:00.000Z', credential_fingerprint: `fp-${id}` },
      ]),
    ),
  })

  it('skips a lapsed lane and serves the next healthy one', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      // Lane A is the head of the sorted candidates — without the holdout it
      // would absorb every retry while B sat idle.
      credentialHealth: refusedHealth(['sub:codex-worker-a']),
    })
    expect(pick.ok).toBe(true)
    if (!pick.ok) throw new Error(pick.reason)
    expect(pick.lane.subscriptionId).toBe('codex-worker-b')
    await pick.lane.lock.release()
  })

  it('when every lane is lapsed the refusal names them and says how to fix it', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      credentialHealth: refusedHealth(['sub:codex-worker-a', 'sub:codex-worker-b']),
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toContain('2 signed-in lane(s) are held out')
    expect(pick.reason).toContain('codex-worker-a (sign-in has lapsed')
    expect(pick.reason).toMatch(/Settings → Subscriptions/)
  })

  it('a brain hold still wins the explanation when both apply', async () => {
    const root = await subsFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openai-codex',
      tryAcquire: locks.tryAcquire,
      homes,
      reserve: { emails: new Set(['worker-a@agents.example.com', 'worker-b@agents.example.com']) },
      credentialHealth: refusedHealth(['sub:codex-worker-a']),
    })
    expect(pick.ok).toBe(false)
    if (pick.ok) throw new Error('expected refusal')
    expect(pick.reason).toMatch(/codex-worker-a \(Waypoint|codex-worker-a \(brain|codex-worker-a \(/)
    expect(pick.reason).not.toContain('codex-worker-a (sign-in has lapsed')
  })
})

describe('createCordisLanePicker (L5)', () => {
  const TARGET = { provider: 'openai-codex', model: 'gpt-5.3-codex-spark', modelClass: 'high' as const }

  it('adopts the picked lane — real held lock, fresh homes and reserve per pick', async () => {
    const root = await subsFixture()
    const env = { WAYPOINT_SUBS_ROOT: root } as NodeJS.ProcessEnv
    const locks = createInProcessOauthLaneLocks()
    const picker = createCordisLanePicker({ locks, env })

    const first = await picker(TARGET)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.reason)
    expect(first.lane.oauth_lane_id).toBe('sub:codex-worker-a')
    expect(first.lane.oauth_provider_slug).toBe('codex')
    expect(first.lane.homePath).toBe(join(root, 'codex-worker-a'))

    // The lock is genuinely HELD: the next pick skips to lane B…
    const second = await picker(TARGET)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    expect(second.lane.oauth_lane_id).toBe('sub:codex-worker-b')

    // …and release() frees the lane for the pick after.
    await first.lane.release()
    await second.lane.release()
    const third = await picker(TARGET)
    expect(third.ok).toBe(true)
    if (!third.ok) throw new Error(third.reason)
    expect(third.lane.oauth_lane_id).toBe('sub:codex-worker-a')
    await third.lane.release()
  })

  it('reads the brain reserve fresh — a brain-held lane is skipped, and its return is picked up', async () => {
    const root = await subsFixture()
    const env = { WAYPOINT_SUBS_ROOT: root } as NodeJS.ProcessEnv
    const locks = createInProcessOauthLaneLocks()
    const picker = createCordisLanePicker({ locks, env })

    await writeFile(
      join(root, 'brain-in-use.json'),
      JSON.stringify({ accounts: [{ email: 'worker-a@agents.example.com' }] }),
      'utf8',
    )
    const held = await picker(TARGET)
    expect(held.ok).toBe(true)
    if (!held.ok) throw new Error(held.reason)
    expect(held.lane.oauth_lane_id).toBe('sub:codex-worker-b')
    await held.lane.release()

    // The registry changes → the very next pick serves lane A again.
    await writeFile(join(root, 'brain-in-use.json'), JSON.stringify({ accounts: [] }), 'utf8')
    const freed = await picker(TARGET)
    expect(freed.ok).toBe(true)
    if (!freed.ok) throw new Error(freed.reason)
    expect(freed.lane.oauth_lane_id).toBe('sub:codex-worker-a')
    await freed.lane.release()
  })

  it('refuses with the picker reason when no lane serves the provider', async () => {
    const root = await subsFixture()
    const picker = createCordisLanePicker({
      locks: createInProcessOauthLaneLocks(),
      env: { WAYPOINT_SUBS_ROOT: root } as NodeJS.ProcessEnv,
    })
    const picked = await picker({ provider: 'grok', model: 'grok-4', modelClass: 'high' })
    expect(picked.ok).toBe(false)
    // Capability is checked before the home list: grok has no broker at all.
    if (!picked.ok) expect(picked.reason).toContain("no usable 'grok' worker lane")
  })
})

describe('openrouter API-key lanes (2026-08-30)', () => {
  async function openrouterFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'lane-or-'))
    await mkdir(join(root, 'openrouter-workers-a'), { recursive: true })
    await writeFile(join(root, 'openrouter-workers-a', 'key'), 'sk-or-test-a\n', 'utf8')
    // Keyless home: recognized but signed OUT until a key is installed.
    await mkdir(join(root, 'openrouter-workers-b'), { recursive: true })
    return root
  }

  it('lists openrouter homes; a non-empty key file is signed in, a keyless home is not', async () => {
    const root = await openrouterFixture()
    const homes = listSubscriptionHomes({ root })
    expect(homes.map((h) => h.id)).toEqual(['openrouter-workers-a', 'openrouter-workers-b'])
    expect(homes[0]).toMatchObject({ provider: 'openrouter', signedIn: true, email: null })
    expect(homes[1]).toMatchObject({ provider: 'openrouter', signedIn: false })
  })

  it("picks a free openrouter lane for piProvider 'openrouter' with its own lane sprite", async () => {
    const root = await openrouterFixture()
    const homes = listSubscriptionHomes({ root })
    const locks = createInProcessOauthLaneLocks()
    const pick = await pickFreeOauthLane({
      piProvider: 'openrouter',
      tryAcquire: locks.tryAcquire,
      homes,
    })
    expect(pick.ok).toBe(true)
    if (!pick.ok) throw new Error(pick.reason)
    expect(pick.lane.subscriptionId).toBe('openrouter-workers-a')
    expect(pick.lane.consoleProvider).toBe('openrouter')
    expect(pick.lane.oauth_lane_id).toBe('sub:openrouter-workers-a')
    expect(pick.lane.sandbox_name).toBe(stableOauthSandboxName('sub:openrouter-workers-a', 'openrouter'))
    expect(pick.lane.sandbox_name).toMatch(/^oauth-openrouter-[0-9a-f]{8}$/)
    expect(pick.lane.envInject).toEqual({ OPENROUTER_HOME: join(root, 'openrouter-workers-a') })
    await pick.lane.lock.release()
  })

  it('maps the openrouter pi provider onto its own console lane family', () => {
    expect(workerLaneConsoleProviderForPiProvider('openrouter')).toBe('openrouter')
  })
})
