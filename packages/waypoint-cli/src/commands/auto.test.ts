import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-auto-'))
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

describe('waypoint auto command', () => {
  it('runs null-runtime autopilot and stops on the first gate task', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '10'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint autopilot')
    expect(output).toContain('status: blocked')
    expect(output).toContain('iterations: 6')
    expect(output).toContain('blocked node: plan-approval-gate')
    expect(output).toContain('completed tasks: task-001, task-002, task-003, task-004, task-005')
  })

  it('lists autopilot run history', async () => {
    const cwd = await startedProject()
    const run = makeIo(cwd)
    expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '2'], run.io)).toBe(0)

    const { io, stdout, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['auto', 'status'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint autopilot runs')
    expect(output).toContain('total: 1')
    expect(output).toContain('- autopilot-run-001 route-001')
    expect(output).toContain('status: iteration_cap')
  })
})
