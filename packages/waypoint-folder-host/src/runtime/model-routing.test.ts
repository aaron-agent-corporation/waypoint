import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadProviderRegistry, parseModelTargets, parseProviderRegistry, resolveModelTarget } from './model-routing.ts'

describe('parseModelTargets (rsc-bpg)', () => {
  it('parses well-formed class -> {provider, model} entries', () => {
    expect(
      parseModelTargets({
        high: { provider: 'anthropic', model: 'claude-opus-4-8' },
        low: { provider: 'openai-codex', model: 'gpt-5.4-mini' },
      }),
    ).toEqual({
      high: { provider: 'anthropic', model: 'claude-opus-4-8' },
      low: { provider: 'openai-codex', model: 'gpt-5.4-mini' },
    })
  })

  it('drops a malformed entry rather than failing config load — it surfaces at resolve time', () => {
    // provider present, model missing: dropped, not fatal.
    expect(parseModelTargets({ high: { provider: 'anthropic' }, low: { provider: 'xai', model: 'grok-4' } })).toEqual({
      low: { provider: 'xai', model: 'grok-4' },
    })
  })

  it('returns undefined when nothing valid is present', () => {
    expect(parseModelTargets({})).toBeUndefined()
    expect(parseModelTargets({ high: 'nope' })).toBeUndefined()
    expect(parseModelTargets(null)).toBeUndefined()
  })

  it('ignores unknown class keys — only high/medium/low route', () => {
    expect(parseModelTargets({ frontier: { provider: 'anthropic', model: 'claude-opus-4-8' } })).toBeUndefined()
  })
})

describe('parseProviderRegistry (rsc-bpg)', () => {
  it('reads subscription vs api_key auth kinds', () => {
    expect(parseProviderRegistry({ anthropic: { auth: 'subscription' }, xai: { auth: 'api_key' } })).toEqual({
      anthropic: { auth: 'subscription' },
      xai: { auth: 'api_key' },
    })
  })

  it('defaults an unclear auth to api_key — treat an ambiguous provider as metered/opt-in, never a free subscription', () => {
    expect(parseProviderRegistry({ mystery: {}, other: { auth: 'nonsense' } })).toEqual({
      mystery: { auth: 'api_key' },
      other: { auth: 'api_key' },
    })
  })

  it('is empty for a non-object', () => {
    expect(parseProviderRegistry(undefined)).toEqual({})
    expect(parseProviderRegistry('anthropic')).toEqual({})
  })
})

describe('resolveModelTarget — subscription-first fail-closed (rsc-bpg)', () => {
  const registry = { anthropic: { auth: 'subscription' as const }, xai: { auth: 'api_key' as const } }
  const modelTargets = {
    high: { provider: 'anthropic', model: 'claude-opus-4-8' },
    medium: { provider: 'xai', model: 'grok-4' },
    low: { provider: 'openai-codex', model: 'gpt-5.4-mini' },
  }

  it('resolves a class whose provider is registered, carrying the auth kind', () => {
    expect(resolveModelTarget('high', { modelTargets, registry })).toEqual({
      ok: true,
      target: { provider: 'anthropic', model: 'claude-opus-4-8' },
      auth: 'subscription',
    })
    expect(resolveModelTarget('medium', { modelTargets, registry })).toMatchObject({ ok: true, auth: 'api_key' })
  })

  it('FAILS CLOSED when the target names an unregistered provider — never substitutes another', () => {
    const result = resolveModelTarget('low', { modelTargets, registry })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('openai-codex')
      expect(result.reason).toContain('not in your provider registry')
      expect(result.reason).toContain('~/.waypoint/config.yaml')
    }
  })

  it('fails when the class has no target at all', () => {
    const result = resolveModelTarget('high', { modelTargets: {}, registry })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("no model target configured for class 'high'")
  })

  it('an empty registry resolves nothing — the subscription-first guard has no default', () => {
    expect(resolveModelTarget('high', { modelTargets, registry: {} }).ok).toBe(false)
  })
})

describe('loadProviderRegistry (rsc-bpg)', () => {
  it('reads providers from <config home>/config.yaml, honoring WAYPOINT_CONFIG_HOME', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-config-home-'))
    await writeFile(
      join(home, 'config.yaml'),
      'model_providers:\n  anthropic:\n    auth: subscription\n  openai-codex:\n    auth: subscription\n  xai:\n    auth: api_key\n',
      'utf8',
    )
    const registry = await loadProviderRegistry({ WAYPOINT_CONFIG_HOME: home })
    expect(registry).toEqual({
      anthropic: { auth: 'subscription' },
      'openai-codex': { auth: 'subscription' },
      xai: { auth: 'api_key' },
    })
  })

  it('is an empty registry when the config is missing — every target then fails closed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-config-empty-'))
    await mkdir(home, { recursive: true })
    expect(await loadProviderRegistry({ WAYPOINT_CONFIG_HOME: home })).toEqual({})
  })
})
