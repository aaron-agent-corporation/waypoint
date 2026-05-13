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

describe('waypoint tools command', () => {
  it('lists safe tools for an operator as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['tools', 'list', '--operator', 'firmvault-paralegal', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { operator_slug: string; tools: Array<{ slug: string; side_effect_class: string }> }
    expect(parsed.operator_slug).toBe('firmvault-paralegal')
    expect(parsed.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'firmvault.state.set', side_effect_class: 'local_state_mutation' }),
        expect.objectContaining({ slug: 'firmvault.document.add', side_effect_class: 'local_file_copy' }),
      ]),
    )
  })

  it('explains a safe tool as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['tools', 'explain', 'firmvault.state.set', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { slug: string; inputs: Array<{ name: string; required: boolean }> }
    expect(parsed.slug).toBe('firmvault.state.set')
    expect(parsed.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'evidence', required: true })]))
  })

  it('rejects an unknown operator', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['tools', 'list', '--operator', 'missing-operator', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown operator: missing-operator')
  })

  it('rejects an unknown tool slug', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['tools', 'explain', 'missing.tool', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown tool: missing.tool')
  })
})
