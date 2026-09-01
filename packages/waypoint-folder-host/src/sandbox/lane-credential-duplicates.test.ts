import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CODEX_JWT_AUTH_CLAIM } from '../runtime/lane-cred-broker.ts'
import {
  contestedAccountHold,
  foreignAccountHomes,
  laneHomeAccountId,
  listCredentialCopies,
  staleDuplicateNote,
} from './lane-credential-duplicates.ts'

const SEC = 1000
function token(accountId: string, issuedDaysAgo: number, livesDays = 10): string {
  const iat = Math.floor((Date.now() - issuedDaysAgo * 86_400 * SEC) / SEC)
  const claims = {
    iat,
    exp: iat + livesDays * 86_400,
    [CODEX_JWT_AUTH_CLAIM]: { chatgpt_account_id: accountId },
  }
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
}

async function home(root: string, name: string, accountId: string, daysAgo: number): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'auth.json'),
    JSON.stringify({ tokens: { access_token: token(accountId, daysAgo), refresh_token: 'r' } }),
    'utf8',
  )
  return dir
}

describe('stale duplicate credential detection', () => {
  it('names the live copy when another store holds the same account, fresher', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'dup-mine-'))
    const foreign = await mkdtemp(join(tmpdir(), 'dup-foreign-'))
    const laneHome = await home(mine, 'codex-shared', 'acct-shared', 31)
    await home(foreign, 'codex-shared', 'acct-shared', 1)

    const note = staleDuplicateNote(laneHome, { stores: [foreign] })
    expect(note).toBeDefined()
    expect(note).toContain('LIVE credential at')
    expect(note).toContain(foreign)
    expect(note).toMatch(/stale duplicate, not a lapsed account/)
    expect(note).toMatch(/one home per account/)
  })

  it('says nothing when no other store holds the account — that lane really did lapse', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'dup-mine-'))
    const foreign = await mkdtemp(join(tmpdir(), 'dup-foreign-'))
    const laneHome = await home(mine, 'codex-solo', 'acct-solo', 31)
    await home(foreign, 'codex-other', 'acct-different', 1)
    expect(staleDuplicateNote(laneHome, { stores: [foreign] })).toBeUndefined()
  })

  it('ignores an OLDER copy elsewhere — only a fresher one explains our refusal', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'dup-mine-'))
    const foreign = await mkdtemp(join(tmpdir(), 'dup-foreign-'))
    const laneHome = await home(mine, 'codex-shared', 'acct-shared', 2)
    await home(foreign, 'codex-shared', 'acct-shared', 40)
    expect(staleDuplicateNote(laneHome, { stores: [foreign] })).toBeUndefined()
  })

  it('reads a store that is itself a home (the codex CLI shape), and never reads tokens', async () => {
    const cli = await mkdtemp(join(tmpdir(), 'dup-cli-'))
    await writeFile(
      join(cli, 'auth.json'),
      JSON.stringify({ tokens: { access_token: token('acct-cli', 1), refresh_token: 'SECRET' } }),
      'utf8',
    )
    const copies = listCredentialCopies([cli])
    expect(copies).toHaveLength(1)
    expect(copies[0]!.accountId).toBe('acct-cli')
    // Identity and timing only — no token material is carried out.
    expect(JSON.stringify(copies)).not.toContain('SECRET')
  })

  it('a missing store, an unreadable home, and an opaque token are all silent', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'dup-mine-'))
    const dir = join(mine, 'codex-opaque')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: 'opaque' } }), 'utf8')
    expect(staleDuplicateNote(dir, { stores: [join(tmpdir(), 'no-such-store')] })).toBeUndefined()
    expect(listCredentialCopies([join(tmpdir(), 'no-such-store')])).toEqual([])
  })
})

describe('dedicated-accounts policy', () => {
  it('holds out a lane whose account another store also signs into, however fresh ours is', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'ded-mine-'))
    const foreign = await mkdtemp(join(tmpdir(), 'ded-foreign-'))
    // Ours is the FRESHER copy — still contested: the other tool rotates next.
    const laneHome = await home(mine, 'codex-shared', 'acct-shared', 0)
    await home(foreign, 'codex-shared', 'acct-shared', 20)

    const hold = contestedAccountHold(laneHome, foreignAccountHomes([foreign]))
    expect(hold).toContain('also signed in at')
    expect(hold).toContain(foreign)
    expect(hold).toMatch(/only dedicated accounts/)
  })

  it('offers a lane whose account nothing else holds', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'ded-mine-'))
    const foreign = await mkdtemp(join(tmpdir(), 'ded-foreign-'))
    const laneHome = await home(mine, 'codex-solo', 'acct-solo', 1)
    await home(foreign, 'codex-other', 'acct-other', 1)
    expect(contestedAccountHold(laneHome, foreignAccountHomes([foreign]))).toBeNull()
  })

  it('fails OPEN on a home whose account cannot be read — never silently shrinks the pool', async () => {
    const mine = await mkdtemp(join(tmpdir(), 'ded-mine-'))
    const laneHome = join(mine, 'codex-opaque')
    await mkdir(laneHome, { recursive: true })
    await writeFile(join(laneHome, 'auth.json'), '{ not json', 'utf8')
    expect(laneHomeAccountId(laneHome)).toBeNull()
    expect(contestedAccountHold(laneHome, new Map([['acct-shared', '/elsewhere/auth.json']]))).toBeNull()
  })

  it('collects accounts across foreign stores, each pointing at its copy', async () => {
    const a = await mkdtemp(join(tmpdir(), 'ded-a-'))
    const b = await mkdtemp(join(tmpdir(), 'ded-b-'))
    await home(a, 'codex-one', 'acct-one', 1)
    await home(b, 'codex-two', 'acct-two', 1)
    const held = foreignAccountHomes([a, b])
    expect([...held.keys()].sort()).toEqual(['acct-one', 'acct-two'])
    expect(held.get('acct-one')).toContain(a)
  })

  it('reads the pi runtime family-keyed store, and never reads its tokens (route-006)', async () => {
    // ~/.pi/agent/auth.json: one file, keyed by provider family — the store a
    // brain session falls back to, where waypoint's old credential hid.
    const piStore = await mkdtemp(join(tmpdir(), 'ded-pi-'))
    await writeFile(
      join(piStore, 'auth.json'),
      JSON.stringify({
        openrouter: { type: 'key', key: 'SECRET-KEY' },
        'openai-codex': { type: 'oauth', access: token('acct-pi', 1), refresh: 'SECRET-REFRESH', expires: 1 },
      }),
      'utf8',
    )
    const copies = listCredentialCopies([piStore])
    expect(copies).toHaveLength(1)
    expect(copies[0]!.accountId).toBe('acct-pi')
    expect(JSON.stringify(copies)).not.toContain('SECRET')

    const mine = await mkdtemp(join(tmpdir(), 'ded-mine-'))
    const laneHome = await home(mine, 'codex-shared', 'acct-pi', 0)
    const hold = contestedAccountHold(laneHome, foreignAccountHomes([piStore]))
    expect(hold).toContain('also signed in at')
    expect(hold).toContain(piStore)
  })

  it('falls back to the accountId recorded beside an opaque pi token', async () => {
    const piStore = await mkdtemp(join(tmpdir(), 'ded-pi-opaque-'))
    await writeFile(
      join(piStore, 'auth.json'),
      JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'opaque-token', accountId: 'acct-opaque' } }),
      'utf8',
    )
    const copies = listCredentialCopies([piStore])
    expect(copies).toHaveLength(1)
    expect(copies[0]!.accountId).toBe('acct-opaque')
    expect(copies[0]!.issuedAtMs).toBeNull()
  })
})
