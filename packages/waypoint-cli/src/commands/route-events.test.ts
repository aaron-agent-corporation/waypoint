import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-route-events-'))
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

describe('waypoint route-events command', () => {
  it('prints paginated route events for a route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--limit', '10', '--offset', '0'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint route events route-001')
    expect(output).toContain('total: 1')
    expect(output).toContain('limit: 10')
    expect(output).toContain('offset: 0')
    expect(output).toContain('- event-001 route.started')
  })

  it('can emit route events as JSON', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      route_id: 'route-001',
      total: 1,
      items: [{ id: 'event-001', kind: 'route.started', route_id: 'route-001' }],
    })
  })
})
