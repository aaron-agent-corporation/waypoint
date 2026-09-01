import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Credential } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { __test, BROKER_ENV, brokeredResolverFactory, readBrokeredCredential } from './pi-cred-broker.ts'

const OAUTH: Credential = { type: 'oauth', refresh: 'refresh-tok', access: 'access-tok', expires: 9_999_999_999 }

describe('BrokeredCredentialStore (rsc-0fx)', () => {
  it('reads, lists, modifies (in-memory), and deletes the seeded credential', async () => {
    const store = new __test.BrokeredCredentialStore({ 'openai-codex': OAUTH })
    expect(await store.read('openai-codex')).toEqual(OAUTH)
    expect(await store.read('nope')).toBeUndefined()
    expect(await store.list()).toEqual([{ providerId: 'openai-codex', type: 'oauth' }])

    // a refresh: modify returns the new credential and it sticks in memory
    const rotated: Credential = { ...OAUTH, access: 'rotated' }
    expect(await store.modify('openai-codex', async () => rotated)).toEqual(rotated)
    expect(await store.read('openai-codex')).toEqual(rotated)

    // fn returning undefined leaves the entry unchanged
    expect(await store.modify('openai-codex', async () => undefined)).toEqual(rotated)

    await store.delete('openai-codex')
    expect(await store.read('openai-codex')).toBeUndefined()
  })
})

describe('readBrokeredCredential — host side (rsc-0fx)', () => {
  it('serializes the provider credential from an auth.json, without mounting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-broker-'))
    const authPath = join(dir, 'auth.json')
    await writeFile(authPath, JSON.stringify({ 'openai-codex': OAUTH, other: { type: 'api_key', key: 'x' } }), 'utf8')

    const blob = await readBrokeredCredential('openai-codex', authPath)
    expect(blob).toBeDefined()
    const parsed = JSON.parse(blob!) as { provider: string; credential: Credential }
    expect(parsed.provider).toBe('openai-codex')
    expect(parsed.credential).toEqual(OAUTH)
  })

  it('returns undefined when the provider has no stored credential (caller fails closed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-broker-'))
    const authPath = join(dir, 'auth.json')
    await writeFile(authPath, JSON.stringify({ 'openai-codex': OAUTH }), 'utf8')
    expect(await readBrokeredCredential('anthropic', authPath)).toBeUndefined()
  })
})

describe('brokeredResolverFactory — child side (rsc-0fx)', () => {
  it('returns undefined when no brokered credential is present', async () => {
    expect(await brokeredResolverFactory({})).toBeUndefined()
    expect(await brokeredResolverFactory({ [BROKER_ENV]: '' })).toBeUndefined()
  })

  it('returns undefined on a malformed brokered blob (fail closed, no throw)', async () => {
    expect(await brokeredResolverFactory({ [BROKER_ENV]: 'not json' })).toBeUndefined()
    expect(await brokeredResolverFactory({ [BROKER_ENV]: JSON.stringify({ provider: 'x' }) })).toBeUndefined()
  })
})
