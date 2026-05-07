import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-pause-'))
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

describe('waypoint pause/resume commands', () => {
  it('pauses and resumes a route', async () => {
    const cwd = await startedProject()
    const pause = makeIo(cwd)

    expect(await runWaypointCli(['pause', '--route-id', 'route-001', '--reason', 'Waiting on review'], pause.io)).toBe(0)
    expect(pause.stderr).toEqual([])
    expect(pause.stdout.join('\n')).toContain('Paused route route-001')
    expect(pause.stdout.join('\n')).toContain('status: blocked')

    const resume = makeIo(cwd)
    expect(await runWaypointCli(['resume', '--route-id', 'route-001'], resume.io)).toBe(0)
    expect(resume.stderr).toEqual([])
    expect(resume.stdout.join('\n')).toContain('Resumed route route-001')
    expect(resume.stdout.join('\n')).toContain('status: active')

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001'], events.io)).toBe(0)
    expect(events.stdout.join('\n')).toContain('event-002 route.paused')
    expect(events.stdout.join('\n')).toContain('event-003 route.resumed')
  })
})
