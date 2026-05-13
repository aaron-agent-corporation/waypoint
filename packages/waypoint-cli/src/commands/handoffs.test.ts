import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

function makeIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('waypoint handoffs command', () => {
  it('lists bundled handoff manifests as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      handoffs: Array<{ slug: string; name: string; handoff_count: number }>
    }
    expect(parsed.handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'firmvault-paralegal-handoffs',
          name: 'FirmVault Paralegal Handoffs',
          handoff_count: 5,
        }),
      ]),
    )
  })

  it('filters bundled handoff manifests by quest as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--quest', 'firmvault', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      quest: string
      handoffs: Array<{ slug: string }>
    }
    expect(parsed.quest).toBe('firmvault')
    expect(parsed.handoffs.map((manifest) => manifest.slug)).toEqual(['firmvault-paralegal-handoffs'])
  })

  it('prints a human-readable handoff manifest list', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Waypoint Handoff Graphs')
    expect(stdout.join('\n')).toContain('- firmvault-paralegal-handoffs: FirmVault Paralegal Handoffs (5 handoffs)')
  })

  it('shows a bundled handoff manifest as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'firmvault-paralegal-handoffs', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      slug: string
      handoffs: Array<{ slug: string; from: string; to: string; trigger: string; gate?: string; required_artifacts?: string[] }>
    }
    expect(parsed.slug).toBe('firmvault-paralegal-handoffs')
    expect(parsed.handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'paralegal-to-attorney-demand-review',
          from: 'firmvault-paralegal',
          to: 'attorney-review',
          trigger: 'demand_package_ready',
          gate: 'human_attorney_review',
        }),
      ]),
    )
  })

  it('prints a human-readable handoff manifest detail view', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'firmvault-paralegal-handoffs'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('FirmVault Paralegal Handoffs (firmvault-paralegal-handoffs)')
    expect(output).toContain('handoffs:')
    expect(output).toContain('- paralegal-to-attorney-demand-review: firmvault-paralegal -> attorney-review')
    expect(output).toContain('trigger: demand_package_ready')
    expect(output).toContain('gate: human_attorney_review')
  })

  it('rejects unknown handoff manifests', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'missing-handoff-graph', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown handoff manifest: missing-handoff-graph')
  })

  it('rejects unknown quests when filtering handoffs', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--quest', 'missing-quest', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown quest: missing-quest')
  })
})
