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
    expect(output).toContain('waypoint')
    expect(output).toContain('Waypoint Quests')
    expect(output).toContain('Primary starter Quests')
    expect(output).toContain('- firmvault: FirmVault')
    expect(output).toContain('  Best for: legal case workflow with evidence-backed FirmVault state')
    expect(output).toContain('- waypoint: Project Delivery (GSD)')
    expect(output).toContain('  Best for: general project planning and execution')
    expect(output).toContain('- agile-delivery: Agile Delivery')
    expect(output).toContain('  Best for: structured software delivery from PRD through sprint execution')
    expect(output).toContain('- product-sprint: Product Sprint')
    expect(output).toContain('  Best for: product ideation, review, QA, and ship cycles')
    expect(output).toContain('- agentic-delivery: Agentic Delivery')
    expect(output).toContain(
      '  Best for: disciplined AI-assisted software delivery from idea through verified branch finish',
    )
    expect(output).toContain('Additional bundled Quests')
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
