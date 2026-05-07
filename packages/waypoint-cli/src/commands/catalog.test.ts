import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin.ts'

function makeIo(cwd = process.cwd()) {
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

describe('catalog commands', () => {
  it('lists bundled Quests', async () => {
    const { io, stdout, stderr } = makeIo()

    const exitCode = await runWaypointCli(['quests'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('waypoint')
    expect(stdout.join('\n')).toContain('Waypoint Quests')
  })

  it('lists Recipes referenced by a bundled Quest', async () => {
    const { io, stdout, stderr } = makeIo()

    const exitCode = await runWaypointCli(['recipes', '--quest', 'waypoint'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Recipes for Quest: waypoint')
    expect(stdout.join('\n')).toContain('waypoint-doc-writer')
  })
})
