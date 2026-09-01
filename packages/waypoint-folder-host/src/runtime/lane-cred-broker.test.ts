import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CODEX_JWT_AUTH_CLAIM,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
  codexAccountIdFromAccessToken,
  decodeJwtPayload,
  laneBrokerSupportHold,
  resolveLaneBrokeredCredential,
} from './lane-cred-broker.ts'
import { BROKER_FILE_ENV, brokeredResolverFactory } from './pi-cred-broker.ts'

function fakeJwt(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
}

const SECONDS = 1000
const inDays = (days: number): number => Math.floor((Date.now() + days * 86_400 * SECONDS) / SECONDS)

/** Any fetch at all is a failure for the no-refresh cases. */
const neverFetch: typeof fetch = () => {
  throw new Error('network must not be touched')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('decodeJwtPayload', () => {
  it('decodes base64url payloads and returns null on garbage', () => {
    expect(decodeJwtPayload(fakeJwt({ email: 'a@b.c', exp: 12 }))).toEqual({ email: 'a@b.c', exp: 12 })
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.!!!.b')).toBeNull()
  })
})

describe('codexAccountIdFromAccessToken', () => {
  it('reads the account binding from the token itself, like pi does', () => {
    const bound = fakeJwt({ [CODEX_JWT_AUTH_CLAIM]: { chatgpt_account_id: 'acct-from-token' } })
    expect(codexAccountIdFromAccessToken(bound)).toBe('acct-from-token')
    expect(codexAccountIdFromAccessToken(fakeJwt({ exp: 1 }))).toBeNull()
    expect(codexAccountIdFromAccessToken('opaque')).toBeNull()
  })
})

describe('resolveLaneBrokeredCredential — codex', () => {
  const chmodBack: string[] = []
  afterEach(async () => {
    for (const dir of chmodBack.splice(0)) await chmod(dir, 0o700).catch(() => {})
  })

  async function codexHome(tokens: unknown, extra: Record<string, unknown> = {}): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'lane-cred-'))
    await writeFile(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: null, ...extra, tokens }), 'utf8')
    return home
  }
  const readHome = async (home: string): Promise<Record<string, any>> =>
    JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))

  it('brokers an ACCESS-ONLY blob from a live lane home, without touching the network', async () => {
    const access = fakeJwt({ exp: inDays(9) })
    const home = await codexHome({ access_token: access, refresh_token: 'refresh-1', account_id: 'acct-9' })
    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl: neverFetch },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.problem)
    const payload = JSON.parse(result.blob) as { provider: string; credential: Record<string, unknown> }
    expect(payload.provider).toBe('openai-codex')
    expect(payload.credential).toEqual({
      type: 'oauth',
      access,
      // The refresh token is HOST-ONLY: a rotated one that reached the guest
      // would die with its in-memory store and burn the lane.
      refresh: '',
      expires: expect.any(Number),
      accountId: 'acct-9',
    })
    expect(result.blob).not.toContain('refresh-1')
  })

  it('refreshes host-side inside the window and PERSISTS the rotation before returning', async () => {
    const home = await codexHome(
      { access_token: fakeJwt({ exp: inDays(-3) }), refresh_token: 'refresh-old', account_id: 'acct-9' },
      { some_console_field: 'preserved' },
    )
    const nextAccess = fakeJwt({ exp: inDays(10) })
    const calls: Array<{ url: string; body: string }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') })
      return jsonResponse(200, {
        access_token: nextAccess,
        refresh_token: 'refresh-rotated',
        id_token: 'id-new',
      })
    }

    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.problem)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(CODEX_OAUTH_TOKEN_URL)
    expect(calls[0]!.body).toContain('grant_type=refresh_token')
    expect(calls[0]!.body).toContain(`client_id=${CODEX_OAUTH_CLIENT_ID}`)

    // The rotation is on DISK — losing it is what burns a lane.
    const onDisk = await readHome(home)
    expect(onDisk.tokens.refresh_token).toBe('refresh-rotated')
    expect(onDisk.tokens.access_token).toBe(nextAccess)
    expect(onDisk.tokens.id_token).toBe('id-new')
    expect(onDisk.tokens.account_id).toBe('acct-9')
    // Codex-CLI shape and unknown Console fields survive the rewrite.
    expect(onDisk.OPENAI_API_KEY).toBeNull()
    expect(onDisk.some_console_field).toBe('preserved')
    expect(typeof onDisk.last_refresh).toBe('string')

    const payload = JSON.parse(result.blob) as { credential: Record<string, unknown> }
    expect(payload.credential.access).toBe(nextAccess)
    expect(payload.credential.refresh).toBe('')
    expect(result.blob).not.toContain('refresh-rotated')
  })

  it('refreshes an undecodable access token rather than brokering expires 0', async () => {
    const home = await codexHome({ access_token: 'opaque-token', refresh_token: 'r' })
    let called = 0
    const fetchImpl: typeof fetch = async () => {
      called += 1
      return jsonResponse(200, { access_token: fakeJwt({ exp: inDays(10) }) })
    }
    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl },
    )
    expect(result.ok).toBe(true)
    expect(called).toBe(1)
    // A provider that does not rotate keeps the existing refresh token on disk.
    expect((await readHome(home)).tokens.refresh_token).toBe('r')
  })

  it('binds the blob to the account the TOKEN names, not a stale disk value', async () => {
    const access = fakeJwt({
      exp: inDays(9),
      [CODEX_JWT_AUTH_CLAIM]: { chatgpt_account_id: 'acct-current' },
    })
    const home = await codexHome({ access_token: access, refresh_token: 'r', account_id: 'acct-stale' })
    const live = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl: neverFetch },
    )
    expect(live.ok).toBe(true)
    if (!live.ok) throw new Error(live.problem)
    expect((JSON.parse(live.blob) as any).credential.accountId).toBe('acct-current')

    // After a refresh the binding comes from the token just issued.
    const expired = await codexHome({
      access_token: fakeJwt({ exp: inDays(-1) }),
      refresh_token: 'r',
      account_id: 'acct-stale',
    })
    const refreshedAccess = fakeJwt({
      exp: inDays(10),
      [CODEX_JWT_AUTH_CLAIM]: { chatgpt_account_id: 'acct-reissued' },
    })
    const out = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: expired },
      { fetchImpl: async () => jsonResponse(200, { access_token: refreshedAccess }) },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error(out.problem)
    expect((JSON.parse(out.blob) as any).credential.accountId).toBe('acct-reissued')
  })

  it('fails closed when the refresh is refused — re-auth, never roll over, disk untouched', async () => {
    const home = await codexHome({ access_token: fakeJwt({ exp: inDays(-3) }), refresh_token: 'refresh-dead' })
    const fetchImpl: typeof fetch = async () => jsonResponse(400, { error: 'invalid_grant' })
    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.problem).toMatch(/HTTP 400 invalid_grant/)
    expect(result.problem).toMatch(/Settings → Subscriptions/)
    expect((await readHome(home)).tokens.refresh_token).toBe('refresh-dead')
  })

  it('fails closed when the network cannot be reached — never a silent stale-token run', async () => {
    const home = await codexHome({ access_token: fakeJwt({ exp: inDays(-3) }), refresh_token: 'r' })
    const fetchImpl: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND auth.openai.com')
    }
    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toMatch(/could not reach/)
  })

  it('refuses to hand out a rotation it could not persist', async () => {
    const home = await codexHome({ access_token: fakeJwt({ exp: inDays(-3) }), refresh_token: 'refresh-old' })
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(200, { access_token: fakeJwt({ exp: inDays(10) }), refresh_token: 'refresh-rotated' })
    await chmod(home, 0o500)
    chmodBack.push(home)
    const result = await resolveLaneBrokeredCredential(
      { piProvider: 'openai-codex', consoleProvider: 'codex', homePath: home },
      { fetchImpl },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem).toMatch(/could not be persisted|refusing to use an unpersisted rotation/)
  })

  it('fails closed on husks and missing homes — re-auth, never roll over', async () => {
    const husk = await codexHome({})
    for (const homePath of [husk, '/nonexistent-lane-home']) {
      const result = await resolveLaneBrokeredCredential(
        { piProvider: 'openai-codex', consoleProvider: 'codex', homePath },
        { fetchImpl: neverFetch },
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.problem).toMatch(/signed out|Subscriptions/)
    }
  })

  it('fails closed for unspiked and unknown console providers', async () => {
    for (const consoleProvider of ['kimi', 'grok']) {
      const result = await resolveLaneBrokeredCredential({ piProvider: 'kimi', consoleProvider, homePath: '/x' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.problem).toContain('cannot broker')
    }
    const unknown = await resolveLaneBrokeredCredential({
      piProvider: 'x',
      consoleProvider: 'claude',
      homePath: '/x',
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.problem).toContain('not a worker-lane Console provider')
  })
})

describe('brokeredResolverFactory — staged credential file (L4 residency)', () => {
  it('reads the staged file, UNLINKS it, and authenticates from it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'staged-cred-'))
    const credPath = join(dir, 'brokered-cred.json')
    const blob = JSON.stringify({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: 'a', refresh: '', expires: 9_999_999_999_000 },
    })
    await writeFile(credPath, blob, 'utf8')

    const resolver = await brokeredResolverFactory({ [BROKER_FILE_ENV]: credPath })
    expect(resolver).toBeDefined()
    // The value must not persist on the filesystem past the read.
    expect(existsSync(credPath)).toBe(false)
  })

  it('returns undefined for a missing or empty staged file — the attempt fails closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'staged-cred-'))
    expect(await brokeredResolverFactory({ [BROKER_FILE_ENV]: join(dir, 'absent.json') })).toBeUndefined()
    const empty = join(dir, 'empty.json')
    await writeFile(empty, '', 'utf8')
    expect(await brokeredResolverFactory({ [BROKER_FILE_ENV]: empty })).toBeUndefined()
  })
})

describe('worker-lane broker capability', () => {
  it('codex is implemented', () => {
    expect(laneBrokerSupportHold('codex')).toBeNull()
    expect(laneBrokerSupportHold('CODEX')).toBeNull()
  })

  it('grok and kimi are recognised lane providers Waypoint cannot broker yet', () => {
    for (const slug of ['grok', 'kimi']) {
      const hold = laneBrokerSupportHold(slug)
      expect(hold).toContain('cannot broker')
      // The point is that signing in harder does not help.
      expect(hold).toMatch(/however it is signed in/)
    }
  })

  it('an unknown provider is not a worker lane at all', () => {
    expect(laneBrokerSupportHold('anthropic')).toMatch(/not a worker-lane Console provider/)
  })

  it('openrouter is an implemented worker-lane provider now', () => {
    expect(laneBrokerSupportHold('openrouter')).toBeNull()
  })
})

describe('resolveLaneBrokeredCredential — openrouter (API-key lane)', () => {
  it('derives pi\'s native ApiKeyCredential from the lane home key file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'or-lane-'))
    await writeFile(join(home, 'key'), 'sk-or-v1-test-0123456789\n', { mode: 0o600 })
    const out = await resolveLaneBrokeredCredential({
      piProvider: 'openrouter',
      consoleProvider: 'openrouter',
      homePath: home,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(JSON.parse(out.blob)).toEqual({
        provider: 'openrouter',
        credential: { type: 'api_key', key: 'sk-or-v1-test-0123456789' },
      })
    }
  })

  it('a missing or empty key file is the account-shaped refusal (laneUnusable), naming the path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'or-lane-'))
    for (const prep of [async () => {}, async () => writeFile(join(home, 'key'), '  \n')]) {
      await prep()
      const out = await resolveLaneBrokeredCredential({
        piProvider: 'openrouter',
        consoleProvider: 'openrouter',
        homePath: home,
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.laneUnusable).toBe(true)
        expect(out.problem).toContain(join(home, 'key'))
      }
    }
  })

  it('the blob flows through the UNCHANGED guest factory and resolves openrouter from the bundled catalog', async () => {
    const home = await mkdtemp(join(tmpdir(), 'or-lane-'))
    await writeFile(join(home, 'key'), 'sk-or-v1-test-abcdef\n', { mode: 0o600 })
    const out = await resolveLaneBrokeredCredential({
      piProvider: 'openrouter',
      consoleProvider: 'openrouter',
      homePath: home,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const blobFile = join(home, 'staged-blob.json')
    await writeFile(blobFile, out.blob, { mode: 0o600 })
    const resolver = await brokeredResolverFactory({ [BROKER_FILE_ENV]: blobFile } as NodeJS.ProcessEnv)
    expect(resolver).toBeDefined()
    // Read-and-unlink residency holds for API-key blobs too.
    expect(existsSync(blobFile)).toBe(false)
    expect(await resolver!.hasConfiguredAuth('openrouter')).toBe(true)
    const model = await resolver!.getModel('openrouter', 'z-ai/glm-4.6')
    expect(model).toBeTruthy()
  })
})
