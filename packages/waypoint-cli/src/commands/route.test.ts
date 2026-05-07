import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-route-'))
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

describe('waypoint route command', () => {
  it('prints full route summary for a route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route', '--route-id', 'route-001'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint route route-001')
    expect(output).toContain('quest: waypoint')
    expect(output).toContain('status: active')
    expect(output).toContain('current node: initialize')
    expect(output).toContain('subject: project/local')
    expect(output).toContain('created_at:')
    expect(output).toContain('updated_at:')
  })

  it('returns a non-zero exit code for a missing route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route', '--route-id', 'route-999'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Route not found: route-999')
  })
})
