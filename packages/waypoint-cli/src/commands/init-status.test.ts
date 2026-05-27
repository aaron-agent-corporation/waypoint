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

    const exitCode = await runWaypointCli(['init', '--quest', 'waypoint'], {
      cwd,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Initialized Waypoint project')

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as Record<string, unknown>
    expect(config.quest).toBe('waypoint')
    expect(config.enabled).toBe(true)
    expect(config.backend).toEqual({ route: 'folder' })
  })

  it('initializes a project with the Beads route backend selected', async () => {
    const cwd = await tempProject()
    const stdout: string[] = []
    const stderr: string[] = []

    const exitCode = await runWaypointCli(['init', '--quest', 'waypoint', '--backend', 'beads'], {
      cwd,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('route backend: beads')

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as Record<string, unknown>
    expect(config.backend).toEqual({ route: 'beads' })
  })

  it('rejects Beads initialization without the Beads backend selected', async () => {
    const cwd = await tempProject()
    const stderr: string[] = []

    const exitCode = await runWaypointCli(['init', '--init-beads'], {
      cwd,
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    })

    expect(exitCode).toBe(1)
    expect(stderr.join('\n')).toContain('--init-beads can only be used with --backend beads')
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

    await runWaypointCli(['init', '--quest', 'waypoint'], {
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
    expect(statusText).toContain('quest: waypoint')
    expect(statusText).toContain('route backend: folder')
  })

  it('prints Beads backend health in status text and JSON', async () => {
    const cwd = await tempProject()
    await runWaypointCli(['init', '--quest', 'waypoint', '--backend', 'beads'], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    })

    const textOutput: string[] = []
    expect(
      await runWaypointCli(['status'], {
        cwd,
        stdout: (line) => textOutput.push(line),
        stderr: () => undefined,
      }),
    ).toBe(0)
    expect(textOutput.join('\n')).toContain('route backend: beads')
    expect(textOutput.join('\n')).toContain('beads workspace:')

    const jsonOutput: string[] = []
    expect(
      await runWaypointCli(['status', '--json'], {
        cwd,
        stdout: (line) => jsonOutput.push(line),
        stderr: () => undefined,
      }),
    ).toBe(0)
    const body = JSON.parse(jsonOutput.join('\n')) as { backend: string; beads: { readiness: { ok: boolean; status: string } } }
    expect(body.backend).toBe('beads')
    expect(body.beads.readiness.ok).toBe(false)
    expect(['missing-workspace', 'missing-command', 'unhealthy']).toContain(body.beads.readiness.status)
  })

  it('summarizes routes after a Quest starts', async () => {
    const cwd = await tempProject()
    await runWaypointCli(['init', '--quest', 'waypoint'], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    })
    await runWaypointCli(['start', '--quest', 'waypoint'], {
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
