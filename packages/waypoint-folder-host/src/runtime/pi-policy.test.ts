import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import type { WaypointProjectPiPolicyRule } from '../project/config.ts'
import { buildPiPolicy } from './pi-policy.ts'

/** A minimal BeforeToolCallContext — the engine only reads toolCall.name + args. */
function ctx(name: string, args: unknown): BeforeToolCallContext {
  return { toolCall: { name }, args } as unknown as BeforeToolCallContext
}

describe('buildPiPolicy (rsc-bhc part 3) — config-driven DENY on granted tools', () => {
  it('returns undefined for no rules (the seam then allows)', () => {
    expect(buildPiPolicy(undefined)).toBeUndefined()
    expect(buildPiPolicy([])).toBeUndefined()
  })

  it('denies a tool outright when a rule names it with no pattern', () => {
    const policy = buildPiPolicy([{ tool: 'bash' }])!
    const verdict = policy(ctx('bash', { cmd: 'ls' }))
    expect(verdict?.block).toBe(true)
    expect(verdict?.reason).toContain("policy denied 'bash'")
  })

  it('allows a tool no rule names', () => {
    const policy = buildPiPolicy([{ tool: 'bash' }])!
    expect(policy(ctx('read_file', { path: 'a.md' }))).toBeUndefined()
  })

  it('denies only when the arg field matches the pattern', () => {
    const policy = buildPiPolicy([{ tool: 'write_file', arg: 'content', matches: 'api[_-]?key', flags: 'i' }])!
    // matches (case-insensitive via flags) → blocked
    expect(policy(ctx('write_file', { path: 'out.md', content: 'my API_KEY = sk-123' }))?.block).toBe(true)
    // no match → allowed
    expect(policy(ctx('write_file', { path: 'out.md', content: 'a harmless summary' }))).toBeUndefined()
    // the guarded field is absent → nothing to deny → allowed
    expect(policy(ctx('write_file', { path: 'out.md' }))).toBeUndefined()
  })

  it('tests the whole serialized args when no arg field is named', () => {
    const policy = buildPiPolicy([{ tool: 'read_file', matches: 'credentials\\.json' }])!
    expect(policy(ctx('read_file', { path: '/x/credentials.json' }))?.block).toBe(true)
    expect(policy(ctx('read_file', { path: '/x/intake.md' }))).toBeUndefined()
  })

  it("a '*' rule governs every granted tool", () => {
    const policy = buildPiPolicy([{ tool: '*', matches: 'BEGIN (RSA )?PRIVATE KEY' }])!
    expect(policy(ctx('write_file', { content: '-----BEGIN PRIVATE KEY-----' }))?.block).toBe(true)
    expect(policy(ctx('list_dir', { path: '-----BEGIN PRIVATE KEY-----' }))?.block).toBe(true)
    expect(policy(ctx('write_file', { content: 'ok' }))).toBeUndefined()
  })

  it('first matching rule wins for the reason', () => {
    const rules: WaypointProjectPiPolicyRule[] = [
      { tool: 'write_file', arg: 'content', matches: 'secret', reason: 'first' },
      { tool: 'write_file', arg: 'content', matches: 'secret', reason: 'second' },
    ]
    const verdict = buildPiPolicy(rules)!(ctx('write_file', { content: 'a secret' }))
    expect(verdict?.reason).toContain('first')
    expect(verdict?.reason).not.toContain('second')
  })

  it('surfaces a custom reason', () => {
    const policy = buildPiPolicy([{ tool: 'bash', reason: 'no shell in this quest' }])!
    expect(policy(ctx('bash', {}))?.reason).toContain('no shell in this quest')
  })

  it('is undefined-safe when there is no tool name', () => {
    const policy = buildPiPolicy([{ tool: 'bash' }])!
    expect(policy(ctx(undefined as unknown as string, {}))).toBeUndefined()
  })

  it('throws on an uncompilable regex (fail-closed backstop; config validation is the first line)', () => {
    expect(() => buildPiPolicy([{ tool: 'write_file', matches: '(' }])).toThrow()
  })
})
