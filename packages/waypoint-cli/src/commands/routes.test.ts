import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-routes-'))
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

async function initializedProjectWithRoute(): Promise<string> {
  const cwd = await tempProject()
  await runWaypointCli(['init', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
  return cwd
}

describe('waypoint routes command', () => {
  it('lists active route id, status, quest, and current node', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['routes'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint routes')
    expect(output).toContain('total: 1')
    expect(output).toContain('- route-001')
    expect(output).toContain('status: active')
    expect(output).toContain('quest: waypoint')
    expect(output).toContain('current node: initialize')
  })

  it('can emit route list as JSON', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['routes', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      routes: [{ id: 'route-001', status: 'active', quest: 'waypoint', current_node: 'initialize' }],
    })
  })
})
