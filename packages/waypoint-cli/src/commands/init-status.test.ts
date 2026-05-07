import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-init-'))
}

describe('waypoint init/status commands', () => {
  it('initializes the current working directory with a selected quest', async () => {
    const cwd = await tempProject()
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runWaypointCli(['init', '--quest', 'gsd'], {
      cwd,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Initialized Waypoint project')

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as Record<string, unknown>
    expect(config.quest).toBe('gsd')
    expect(config.enabled).toBe(true)
  })

  it('prints uninitialized and initialized status for the current working directory', async () => {
    const cwd = await tempProject()
    const beforeOutput: string[] = []

    expect(
      await runWaypointCli(['status'], {
        cwd,
        stdout: (line) => beforeOutput.push(line),
        stderr: (line) => beforeOutput.push(line),
      }),
    ).toBe(0)
    expect(beforeOutput.join('\n')).toContain('initialized: false')

    await runWaypointCli(['init', '--quest', 'gsd'], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    })

    const afterOutput: string[] = []
    expect(
      await runWaypointCli(['status'], {
        cwd,
        stdout: (line) => afterOutput.push(line),
        stderr: (line) => afterOutput.push(line),
      }),
    ).toBe(0)

    const statusText = afterOutput.join('\n')
    expect(statusText).toContain('initialized: true')
    expect(statusText).toContain('enabled: true')
    expect(statusText).toContain('quest: gsd')
  })

  it('summarizes routes after a Quest starts', async () => {
    const cwd = await tempProject()
    await runWaypointCli(['init', '--quest', 'gsd'], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    })
    await runWaypointCli(['start', '--quest', 'gsd'], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    })

    const output: string[] = []
    expect(
      await runWaypointCli(['status'], {
        cwd,
        stdout: (line) => output.push(line),
        stderr: (line) => output.push(line),
      }),
    ).toBe(0)

    const statusText = output.join('\n')
    expect(statusText).toContain('routes: 1')
    expect(statusText).toContain('active routes: 1')
    expect(statusText).toContain('blocked gates: 0')
  })
})
