import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-discuss-'))
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

describe('waypoint discuss command', () => {
  it('appends and lists task-scoped discussion messages', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['discuss', '--task-id', 'task-003', '--message', 'Need acceptance criteria'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint discussion task-003')
    expect(output).toContain('conversation: task:3:discussion:waypoint-doc-writer')
    expect(output).toContain('- message-001 user')
    expect(output).toContain('Need acceptance criteria')
    expect(output).toContain('auto_response: requested=false reason=global_disabled agent=waypoint-doc-writer')
  })

  it('records agent-authored messages without recursive auto-response', async () => {
    const cwd = await startedProject()
    const { io, stdout } = makeIo(cwd)

    expect(
      await runWaypointCli(['discuss', '--task-id', 'task-003', '--author', 'agent', '--message', 'Agent reply'], io),
    ).toBe(0)
    expect(stdout.join('\n')).toContain('auto_response: requested=false reason=agent_authored agent=waypoint-doc-writer')
  })
})
