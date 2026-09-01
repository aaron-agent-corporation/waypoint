import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { brainFamilyAmbiguityHold, laneBrainHold, readBrainReserve } from './brain-reserve.ts'

/**
 * The bridge must never hand a dispatch to a lane whose account is serving
 * Waypoint's brain — and must never STALL because the registry is absent.
 */

describe('brain reserve', () => {
  it('reads the Console registry and matches lane emails case-insensitively', async () => {
    const subs = await mkdtemp(join(tmpdir(), 'brain-reserve-'))
    await writeFile(
      join(subs, 'brain-in-use.json'),
      JSON.stringify({
        schema_version: 1,
        accounts: [
          { family: 'openai-codex', id: 'default', email: null, account_id: 'acc_1' },
          { family: 'openai-codex', id: 'pi-openai-codex-perry', email: 'Perry@agents.example.com' },
        ],
      }),
      'utf8',
    )
    const reserve = await readBrainReserve({ WAYPOINT_SUBS_ROOT: subs } as NodeJS.ProcessEnv)

    expect(laneBrainHold('perry@agents.example.com', reserve)).toContain("serving Waypoint's brain")
    expect(laneBrainHold('PERRY@AGENTS.EXAMPLE.COM', reserve)).not.toBeNull()
    expect(laneBrainHold('garry@agents.example.com', reserve)).toBeNull()
    // A lane with no declared email cannot be reserved (the default brain's
    // email-less row reserves nothing on the lane side).
    expect(laneBrainHold(undefined, reserve)).toBeNull()
  })

  it('fails open on a missing or malformed registry', async () => {
    const subs = await mkdtemp(join(tmpdir(), 'brain-reserve-'))
    const missing = await readBrainReserve({ WAYPOINT_SUBS_ROOT: subs } as NodeJS.ProcessEnv)
    expect(laneBrainHold('perry@agents.example.com', missing)).toBeNull()

    await writeFile(join(subs, 'brain-in-use.json'), 'not json', 'utf8')
    const malformed = await readBrainReserve({ WAYPOINT_SUBS_ROOT: subs } as NodeJS.ProcessEnv)
    expect(malformed.emails.size).toBe(0)

    await writeFile(join(subs, 'brain-in-use.json'), JSON.stringify({ accounts: 'nope' }), 'utf8')
    expect((await readBrainReserve({ WAYPOINT_SUBS_ROOT: subs } as NodeJS.ProcessEnv)).emails.size).toBe(0)
  })
})

describe('a brain family the registry cannot name (fails closed)', () => {
  it('holds out every lane of a family reserved without an email', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brain-unnamed-'))
    await writeFile(
      join(root, 'brain-in-use.json'),
      JSON.stringify({
        schema_version: 1,
        accounts: [
          { family: 'openai-codex', id: 'default', email: 'brain@example.com', account_id: 'a' },
          // Live shape, 2026-08-29: the Console resolves the default brain's
          // email by account id, which only codex records — so xai lands here.
          { family: 'xai', id: 'default', email: null, account_id: null },
        ],
      }),
      'utf8',
    )
    const reserve = await readBrainReserve({ WAYPOINT_SUBS_ROOT: root } as NodeJS.ProcessEnv)
    expect(reserve.emails.has('brain@example.com')).toBe(true)
    expect(brainFamilyAmbiguityHold('xai', reserve)).toMatch(/does not name which account/)
    // A family the brain named IS provable — no ambiguity hold on codex.
    expect(brainFamilyAmbiguityHold('openai-codex', reserve)).toBeNull()
    expect(brainFamilyAmbiguityHold('kimi', reserve)).toBeNull()
  })
})
