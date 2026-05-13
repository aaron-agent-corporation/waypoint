import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

function makeIo(cwd?: string) {
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

describe('waypoint author command', () => {
  it('prints the brainstorming questionnaire as JSON without writing files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'brainstorm', '--kind', 'quest', '--domain', 'firmvault', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; groups: Array<{ slug: string }>; approval: { required_before: string[] } }
    expect(parsed.kind).toBe('quest')
    expect(parsed.groups[0]?.slug).toBe('brainstorming-context')
    expect(parsed.approval.required_before).toContain('quest_manifest')
  })

  it('writes a pending design spec only under a safe relative docs path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        title: 'FirmVault Followup Workflow',
        kind: 'quest',
        domain: 'firmvault',
        inspected_paths: ['quests/firmvault.yaml'],
        goal: 'Track follow-up tasks after demand package review.',
        constraints: ['No external side effects'],
        approaches: [
          { slug: 'extend', title: 'Extend FirmVault Quest', tradeoffs: ['Fastest'], recommended: true },
          { slug: 'separate', title: 'Separate Quest', tradeoffs: ['Cleaner boundary'], recommended: false },
        ],
        lifecycle: { workstreams: [] },
        roles: ['firmvault-paralegal'],
        tool_boundaries: ['Waypoint safe tools only'],
        verification: ['pnpm test'],
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(
      await runWaypointCli(
        ['author', 'design', '--answers', answersPath, '--write-spec', 'docs/plans/generated-firmvault-followup-design.md', '--json'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { approval: { status: string }; written_path: string; blocked_next_steps: string[] }
    expect(parsed.approval.status).toBe('pending')
    expect(parsed.written_path).toBe('docs/plans/generated-firmvault-followup-design.md')
    expect(parsed.blocked_next_steps).toContain('implementation_plan')
    const written = await readFile(join(temp, 'docs/plans/generated-firmvault-followup-design.md'), 'utf8')
    expect(written).toContain('# FirmVault Followup Workflow')
    expect(written).toContain('status: pending')
  })

  it('refuses unsafe absolute design-spec output paths', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'answers.json')
    await writeFile(answersPath, JSON.stringify({ title: 'Bad', approaches: [] }))
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'design', '--answers', answersPath, '--write-spec', '/tmp/generated.md', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Refusing to write outside a safe relative authoring path')
  })
})
