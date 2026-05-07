import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-tasks-'))
  await runWaypointCli(['init', '--quest', 'gsd'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'gsd'], { cwd, stdout: () => undefined, stderr: () => undefined })
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

describe('waypoint tasks command', () => {
  it('lists materialized tasks for a route', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', '--route-id', 'route-001'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint tasks')
    expect(output).toContain('total: 12')
    expect(output).toContain('- task-003 discuss-objective')
    expect(output).toContain('  kind: discussion')
    expect(output).toContain('  agent: gsd-doc-writer')
  })

  it('can emit tasks as JSON', async () => {
    const cwd = await startedProject()
    const { io, stdout } = makeIo(cwd)

    expect(await runWaypointCli(['tasks', '--json'], io)).toBe(0)
    const parsed = JSON.parse(stdout.join('\n')) as { tasks: Array<{ id: string; route_id: string }> }
    expect(parsed.tasks).toHaveLength(12)
    expect(parsed.tasks[0]).toMatchObject({ id: 'task-001', route_id: 'route-001' })
  })
})
