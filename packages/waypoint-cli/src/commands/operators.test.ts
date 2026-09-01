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
      expect.arrayContaining([expect.objectContaining({ slug: 'research-analyst', role: 'Research Operator' })]),
    )
  })

  it('shows a bundled operator as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'show', 'research-analyst', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { slug: string; allowed_tools: Array<{ slug: string }> }
    expect(parsed.slug).toBe('research-analyst')
    expect(parsed.allowed_tools.map((tool) => tool.slug)).toEqual(expect.arrayContaining(['example.search']))
  })

  it('prints a human-readable operator list', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'list'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Operators')
    expect(stdout.join('\n')).toContain('- research-analyst: Research Analyst')
  })

  it('prints bundled operator instruction resolution as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'instructions', 'research-analyst', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      operator_slug: string
      layers: Array<{ kind: string; ref: string; exists: boolean; required: boolean }>
      errors: string[]
    }
    expect(parsed.operator_slug).toBe('research-analyst')
    expect(parsed.layers.map((layer) => layer.ref)).toEqual(
      expect.arrayContaining(['docs/operators/research-analyst-runbook.md']),
    )
    expect(parsed.layers.find((layer) => layer.ref === 'docs/operators/research-analyst-runbook.md')).toMatchObject({
      exists: true,
      required: true,
    })
  })

  it('rejects unknown operators', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['operators', 'show', 'missing-operator', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown operator: missing-operator')
  })
})
