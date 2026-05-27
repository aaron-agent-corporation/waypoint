import { describe, expect, it } from 'vitest'

import type { WaypointBeadsCliCommandInput, WaypointBeadsCliCommandOutput, WaypointBeadsCliCommandRunner } from './cli-client.ts'
import {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  initializeWaypointBeadsWorkspace,
} from './workspace.ts'

describe('Waypoint Beads workspace readiness', () => {
  it('reports a missing bd command with an actionable hint', async () => {
    const runner: WaypointBeadsCliCommandRunner = {
      async run() {
        const error = new Error('spawn bd ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      },
    }

    const readiness = await checkWaypointBeadsWorkspace({ runner })

    expect(readiness).toMatchObject({
      ok: false,
      status: 'missing-command',
      message: 'Beads route backend requires the bd CLI, but bd was not found.',
    })
    expect(formatWaypointBeadsWorkspaceReadinessFailure(readiness)).toContain('Install Beads')
  })

  it('reports a missing Beads workspace from bd where JSON', async () => {
    const runner = recordingRunner([
      {
        exitCode: 1,
        signal: null,
        stdout: JSON.stringify({
          error: 'no_beads_directory',
          message: 'No active beads workspace found.',
          hint: "run 'bd init' to create a new database",
        }),
        stderr: '',
      },
    ])

    const readiness = await checkWaypointBeadsWorkspace({ cwd: '/tmp/project', runner })

    expect(runner.calls[0]).toMatchObject({ command: 'bd', args: ['where', '--json'], cwd: '/tmp/project' })
    expect(readiness).toMatchObject({
      ok: false,
      status: 'missing-workspace',
      message: 'No active beads workspace found.',
      hint: "run 'bd init' to create a new database",
    })
  })

  it('reports a healthy Beads workspace path and prefix', async () => {
    const runner = recordingRunner([
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          path: '/tmp/project/.beads',
          database_path: '/tmp/project/.beads/embeddeddolt',
          prefix: 'project',
        }),
        stderr: '',
      },
    ])

    await expect(checkWaypointBeadsWorkspace({ runner })).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      path: '/tmp/project/.beads',
      databasePath: '/tmp/project/.beads/embeddeddolt',
      prefix: 'project',
    })
  })

  it('initializes Beads non-interactively and rechecks readiness', async () => {
    const runner = recordingRunner([
      { exitCode: 0, signal: null, stdout: 'initialized', stderr: '' },
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({ path: '/tmp/My Project/.beads', prefix: 'my-project' }),
        stderr: '',
      },
    ])

    const readiness = await initializeWaypointBeadsWorkspace({ cwd: '/tmp/My Project', runner })

    expect(runner.calls[0]).toMatchObject({
      args: ['init', '--non-interactive', '--skip-agents', '--skip-hooks', '--prefix', 'my-project'],
      cwd: '/tmp/My Project',
    })
    expect(runner.calls[1]).toMatchObject({ args: ['where', '--json'], cwd: '/tmp/My Project' })
    expect(readiness).toMatchObject({ ok: true, status: 'ready', prefix: 'my-project' })
  })

  it('surfaces failed bd init output as an unhealthy workspace', async () => {
    const runner = recordingRunner([
      { exitCode: 2, signal: null, stdout: '', stderr: 'database locked' },
    ])

    await expect(initializeWaypointBeadsWorkspace({ runner })).resolves.toMatchObject({
      ok: false,
      status: 'unhealthy',
      message: 'Beads workspace initialization failed.',
      details: 'database locked',
    })
  })
})

function recordingRunner(outputs: readonly WaypointBeadsCliCommandOutput[]): WaypointBeadsCliCommandRunner & {
  readonly calls: WaypointBeadsCliCommandInput[]
} {
  const calls: WaypointBeadsCliCommandInput[] = []
  return {
    calls,
    async run(input) {
      calls.push(input)
      const output = outputs[calls.length - 1]
      if (!output) throw new Error(`Unexpected command: ${input.command} ${input.args.join(' ')}`)
      return output
    },
  }
}
