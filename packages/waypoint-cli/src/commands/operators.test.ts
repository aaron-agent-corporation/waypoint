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

describe('waypoint operators command', () => {
  it('lists bundled operators as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'list', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { operators: Array<{ slug: string; role: string }> }
    expect(parsed.operators).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'firmvault-paralegal', role: 'Paralegal Case Operator' })]),
    )
  })

  it('shows a bundled operator as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'show', 'firmvault-paralegal', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { slug: string; allowed_tools: Array<{ slug: string }> }
    expect(parsed.slug).toBe('firmvault-paralegal')
    expect(parsed.allowed_tools.map((tool) => tool.slug)).toEqual(expect.arrayContaining(['firmvault.state.set']))
  })

  it('prints a human-readable operator list', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'list'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Waypoint Operators')
    expect(stdout.join('\n')).toContain('- firmvault-paralegal: FirmVault Paralegal')
  })

  it('rejects unknown operators', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'show', 'missing-operator', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown operator: missing-operator')
  })
})
