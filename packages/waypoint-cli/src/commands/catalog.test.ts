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
    const output = stdout.join('\n')
    expect(output).toContain('Quests')
    expect(output).toContain('Available quests (1)')
    expect(output).toContain('- runner')
  })

  it('lists Recipes referenced by a bundled Quest', async () => {
    const { io, stdout, stderr } = makeIo()

    const exitCode = await runWaypointCli(['recipes', '--quest', 'runner'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    // The scaffold dispatches nothing: every plan is a checkpoint (D6).
    expect(stdout.join('\n')).toContain('Task quests for quest: runner')
    expect(stdout.join('\n')).not.toContain('runner-doc-writer')
  })
})
