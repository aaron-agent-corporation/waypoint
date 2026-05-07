import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-gate-'))
}

async function startedProject(): Promise<string> {
  const cwd = await tempProject()
  await runWaypointCli(['init', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
  return cwd
}

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('waypoint gate command', () => {
  it('approves a gate and appends a gate-approved event', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['gate', '--route-id', 'route-001', '--node', 'human_plan_gate', '--approve', '--note', 'Plan accepted'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Approved gate human_plan_gate on route route-001')
    expect(output).toContain('status: active')
    expect(output).toContain('note: Plan accepted')

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001'], events.io)).toBe(0)
    expect(events.stdout.join('\n')).toContain('event-002 route.gate.approved')
  })

  it('rejects a gate and surfaces blocked gate count in status', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['gate', '--route-id', 'route-001', '--node', 'human_plan_gate', '--reject', '--note', 'Plan needs work'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Rejected gate human_plan_gate on route route-001')
    expect(output).toContain('status: blocked')

    const status = makeIo(cwd)
    expect(await runWaypointCli(['status'], status.io)).toBe(0)
    expect(status.stdout.join('\n')).toContain('blocked gates: 1')
  })

  it('requires exactly one gate decision', async () => {
    const cwd = await startedProject()
    const { io, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'human_plan_gate'], io)).toBe(1)
    expect(stderr.join('\n')).toContain('Exactly one of --approve or --reject is required')
  })
})
