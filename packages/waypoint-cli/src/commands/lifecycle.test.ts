import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-lifecycle-'))
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

describe('waypoint lifecycle command', () => {
  it('adds lifecycle records and lists a readable summary', async () => {
    const cwd = await tempProject()
    await runWaypointCli(['init', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })

    for (const args of [
      ['lifecycle', 'add', 'workstream', '--key', 'core', '--name', 'Core'],
      ['lifecycle', 'add', 'milestone', '--workstream', 'core', '--key', 'v1', '--title', 'First Release'],
      ['lifecycle', 'add', 'phase', '--milestone', 'v1', '--key', 'execute', '--lifecycle', 'execute'],
      ['lifecycle', 'add', 'plan', '--phase', 'execute', '--ref', 'P-1', '--title', 'Build intake form'],
    ] as const) {
      const { io, stderr } = makeIo(cwd)
      expect(await runWaypointCli(args, io)).toBe(0)
      expect(stderr).toEqual([])
    }

    const workstreams = yamlParse(await readFile(join(cwd, '.waypoint/lifecycle/workstreams.yaml'), 'utf8')) as {
      workstreams: Array<Record<string, unknown>>
    }
    const plans = yamlParse(await readFile(join(cwd, '.waypoint/lifecycle/plans.yaml'), 'utf8')) as {
      plans: Array<Record<string, unknown>>
    }

    expect(workstreams.workstreams[0]).toMatchObject({ key: 'core', name: 'Core' })
    expect(plans.plans[0]).toMatchObject({ phase: 'execute', ref: 'P-1', title: 'Build intake form' })

    const { io, stdout, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['lifecycle', 'list'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint lifecycle')
    expect(output).toContain('workstreams: 1')
    expect(output).toContain('- core: Core')
    expect(output).toContain('milestones: 1')
    expect(output).toContain('- v1: First Release')
    expect(output).toContain('phases: 1')
    expect(output).toContain('- execute: execute')
    expect(output).toContain('plans: 1')
    expect(output).toContain('- P-1: Build intake form')
  })
})
