import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return { io: { cwd, stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) }, stdout, stderr }
}

async function configHome(providersYaml: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'pr-providers-home-'))
  await writeFile(join(home, 'config.yaml'), providersYaml, 'utf8')
  return home
}

async function projectWith(runtimeYaml: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pr-providers-proj-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  await writeFile(
    join(root, '.waypoint', 'config.yaml'),
    `schema_version: 1\nquest: runner\nbackend:\n  route: postgres\nruntime:\n${runtimeYaml}`,
    'utf8',
  )
  return root
}

const savedHome = process.env.WAYPOINT_CONFIG_HOME
afterEach(() => {
  if (savedHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
  else process.env.WAYPOINT_CONFIG_HOME = savedHome
})

describe('waypoint providers (rsc-bpg)', () => {
  it('resolves every declared class against the registry and exits 0', async () => {
    process.env.WAYPOINT_CONFIG_HOME = await configHome(
      'model_providers:\n  anthropic:\n    auth: subscription\n  openai-codex:\n    auth: subscription\n',
    )
    const root = await projectWith(
      '  recipe: worker\n  model_targets:\n    high:\n      provider: anthropic\n      model: claude-opus-4-8\n    low:\n      provider: openai-codex\n      model: gpt-5.4-mini\n',
    )
    const { io, stdout } = makeIo(root)

    const code = await runWaypointCli(['providers'], io)

    const out = stdout.join('\n')
    expect(out).toContain('anthropic (subscription)')
    expect(out).toContain('high: anthropic/claude-opus-4-8 (subscription)')
    expect(out).toContain('low: openai-codex/gpt-5.4-mini (subscription)')
    expect(out).toContain('medium: (unrouted)')
    expect(code).toBe(0)
  })

  it('FAILS (exit 1) when a declared target names an unregistered provider — subscription-first', async () => {
    // Only anthropic is registered; the project routes `low` to xai.
    process.env.WAYPOINT_CONFIG_HOME = await configHome('model_providers:\n  anthropic:\n    auth: subscription\n')
    const root = await projectWith(
      '  recipe: worker\n  model_targets:\n    low:\n      provider: xai\n      model: grok-4\n',
    )
    const { io, stdout } = makeIo(root)

    const code = await runWaypointCli(['providers'], io)

    expect(stdout.join('\n')).toContain('low: MISCONFIGURED')
    expect(stdout.join('\n')).toContain('xai')
    expect(code).toBe(1)
  })

  it('--json emits the registry and resolutions', async () => {
    process.env.WAYPOINT_CONFIG_HOME = await configHome('model_providers:\n  anthropic:\n    auth: subscription\n')
    const root = await projectWith(
      '  recipe: worker\n  model_targets:\n    high:\n      provider: anthropic\n      model: claude-opus-4-8\n',
    )
    const { io, stdout } = makeIo(root)

    const code = await runWaypointCli(['providers', '--json'], io)

    const parsed = JSON.parse(stdout.join('\n')) as { providers: Record<string, unknown>; resolutions: Array<{ class: string; status: string }> }
    expect(parsed.providers.anthropic).toEqual({ auth: 'subscription' })
    expect(parsed.resolutions.find((r) => r.class === 'high')?.status).toBe('resolved')
    expect(code).toBe(0)
  })

  it('outside a project: shows the registry, resolves nothing, exits 0 (not a failure)', async () => {
    process.env.WAYPOINT_CONFIG_HOME = await configHome('model_providers:\n  anthropic:\n    auth: subscription\n')
    const empty = await mkdtemp(join(tmpdir(), 'pr-providers-noproj-'))
    const { io, stdout } = makeIo(empty)

    const code = await runWaypointCli(['providers'], io)

    expect(stdout.join('\n')).toContain('anthropic (subscription)')
    expect(stdout.join('\n')).toContain('no project in scope')
    expect(code).toBe(0)
  })
})
