import { describe, expect, it } from 'vitest'

import {
  SpawnWaypointGasCityCommandRunner,
  WaypointGasCityCliAdapter,
  WaypointGasCityCliCommandError,
  diagnoseWaypointGasCityState,
  formatWaypointGasCityErrorEnvelope,
  type WaypointGasCityCommandInput,
  type WaypointGasCityCommandOutput,
  type WaypointGasCityCommandRunner,
} from './cli-adapter.ts'

describe('WaypointGasCityCliAdapter', () => {
  it('constructs scoped gc commands and parses status, sessions, and events', async () => {
    const runner = createRecordingRunner([
      { exitCode: 0, signal: null, stdout: '1.1.0\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'initialized\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'registered\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'rig added\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'Created convoy wpg-cv1 "waypoint-route-001" tracking 1 issue(s)\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'routed wpg-1\n', stderr: '' },
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({
          sessions: [
            {
              id: 'codex-adhoc-ready-001',
              status: 'running',
              target: 'waypoint/codex',
              template_name: 'codex',
              age_seconds: 35,
            },
          ],
        }),
        stderr: '',
      },
      { exitCode: 0, signal: null, stdout: JSON.stringify({ controller: 'running' }), stderr: '' },
      {
        exitCode: 0,
        signal: null,
        stdout: '{"type":"session.started","payload":{"session":"codex-adhoc-ready-001"}}\n{"type":"bead.routed"}\n',
        stderr: '',
      },
    ])
    const adapter = new WaypointGasCityCliAdapter({
      command: 'gc-test',
      city: '/tmp/city',
      cwd: '/tmp/project',
      runner,
    })

    await expect(adapter.version()).resolves.toEqual({ version: '1.1.0', raw: '1.1.0' })
    await adapter.initCity({ city: '/tmp/city', provider: 'codex', name: 'test-city', skipProviderReadiness: true })
    await adapter.registerCity({ name: 'test-city' })
    await adapter.addRig({
      path: '/tmp/project',
      name: 'waypoint',
      prefix: 'WPG',
      include: ['packs/codex'],
      adopt: true,
      startSuspended: true,
    })
    await expect(adapter.createConvoy({
      rig: 'waypoint',
      name: 'waypoint-route-001',
      issueIds: ['wpg-1'],
      owner: 'mayor',
      notify: 'mayor',
      merge: 'mr',
      owned: true,
      target: 'integration/waypoint',
    })).resolves.toMatchObject({
      convoyId: 'wpg-cv1',
      name: 'waypoint-route-001',
      issueIds: ['wpg-1'],
    })
    await expect(adapter.slingBead({ rig: 'waypoint', target: 'waypoint/codex', beadId: 'wpg-1' })).resolves.toMatchObject({
      target: 'waypoint/codex',
      beadId: 'wpg-1',
    })
    await expect(adapter.listSessions({ state: 'all', template: 'codex' })).resolves.toMatchObject({
      sessions: [
        {
          id: 'codex-adhoc-ready-001',
          status: 'running',
          target: 'waypoint/codex',
          template: 'codex',
          ageSeconds: 35,
        },
      ],
    })
    await expect(adapter.status()).resolves.toMatchObject({ status: { controller: 'running' } })
    await expect(adapter.readEvents({ since: '10m', type: 'session.drained', payloadMatch: ['payload.reason=config-drift'] })).resolves.toMatchObject({
      events: [{ type: 'session.started' }, { type: 'bead.routed' }],
    })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['version'],
      ['init', '--provider', 'codex', '--name', 'test-city', '--skip-provider-readiness', '/tmp/city'],
      ['register', '/tmp/city', '--name', 'test-city'],
      [
        '--city',
        '/tmp/city',
        'rig',
        'add',
        '/tmp/project',
        '--name',
        'waypoint',
        '--prefix',
        'WPG',
        '--include',
        'packs/codex',
        '--adopt',
        '--start-suspended',
      ],
      [
        '--city',
        '/tmp/city',
        '--rig',
        'waypoint',
        'convoy',
        'create',
        'waypoint-route-001',
        'wpg-1',
        '--owner',
        'mayor',
        '--notify',
        'mayor',
        '--merge',
        'mr',
        '--owned',
        '--target',
        'integration/waypoint',
      ],
      ['--city', '/tmp/city', '--rig', 'waypoint', 'sling', 'waypoint/codex', 'wpg-1', '--no-formula', '--nudge'],
      ['--city', '/tmp/city', 'session', 'list', '--json', '--state', 'all', '--template', 'codex'],
      ['--city', '/tmp/city', 'status', '--json'],
      ['--city', '/tmp/city', 'events', '--since', '10m', '--type', 'session.drained', '--payload-match', 'payload.reason=config-drift'],
    ])
    expect(runner.calls.every((call) => call.command === 'gc-test')).toBe(true)
    expect(runner.calls.every((call) => call.cwd === '/tmp/project')).toBe(true)
  })

  it('normalizes preflight failures without throwing', async () => {
    const missingDolt = Object.assign(new Error('spawn dolt ENOENT'), { code: 'ENOENT' })
    const runner = createRecordingRunner([
      { exitCode: 0, signal: null, stdout: '1.1.0\n', stderr: '' },
      { exitCode: 1, signal: null, stdout: '', stderr: 'bd missing\n' },
      missingDolt,
      { exitCode: 0, signal: null, stdout: 'flock 0.4.0\n', stderr: '' },
      { exitCode: 0, signal: null, stdout: 'codex-cli 0.128.0\n', stderr: '' },
    ])
    const adapter = new WaypointGasCityCliAdapter({ command: 'gc-test', runner })

    const result = await adapter.preflight({ provider: 'codex' })

    expect(result.ok).toBe(false)
    expect(result.checks).toMatchObject([
      { tool: 'gc', command: 'gc-test', args: ['version'], ok: true, version: '1.1.0' },
      { tool: 'bd', command: 'bd', args: ['--version'], ok: false, details: 'bd missing' },
      { tool: 'dolt', command: 'dolt', args: ['version'], ok: false, details: 'spawn dolt ENOENT' },
      { tool: 'flock', command: 'flock', args: ['--version'], ok: true, version: 'flock 0.4.0' },
      { tool: 'codex', command: 'codex', args: ['--version'], ok: true, version: 'codex-cli 0.128.0' },
    ])
  })

  it('throws typed command errors and formats CLI error envelopes', async () => {
    const runner = createRecordingRunner([{ exitCode: 2, signal: null, stdout: '', stderr: 'bad target\n' }])
    const adapter = new WaypointGasCityCliAdapter({ runner })

    let caught: unknown
    try {
      await adapter.slingBead({ city: '/tmp/city', target: 'waypoint/codex', beadId: 'wpg-1' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(WaypointGasCityCliCommandError)
    expect(caught).toMatchObject({
      operation: 'sling bead',
      exitCode: 2,
      stderr: 'bad target\n',
    })
    expect(formatWaypointGasCityErrorEnvelope(caught)).toEqual({
      ok: false,
      action: 'error',
      error: 'Gas City CLI sling bead failed.',
      details: 'bad target',
    })
  })

  it('parses capitalized session list fields from the Gas City CLI', async () => {
    const runner = createRecordingRunner([
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([
          {
            ID: 'ci-123',
            Template: 'codex-worker',
            State: 'creating',
            Name: 'runtime-target',
            Alias: 'worker-alias',
            AgentName: 'waypoint/codex',
            SessionName: 'codex-ci-123',
            DrainReason: 'config-drift',
            CreatedAt: '2026-05-28T14:02:57Z',
            LastActive: '2026-05-28T14:03:06Z',
            Closed: false,
          },
        ]),
        stderr: '',
      },
    ])
    const adapter = new WaypointGasCityCliAdapter({ runner })

    await expect(adapter.listSessions({ state: 'all' })).resolves.toMatchObject({
      sessions: [
        {
          id: 'ci-123',
          status: 'creating',
          name: 'runtime-target',
          target: 'worker-alias',
          template: 'codex-worker',
          alias: 'worker-alias',
          agentName: 'waypoint/codex',
          sessionName: 'codex-ci-123',
          drainReason: 'config-drift',
          createdAt: '2026-05-28T14:02:57Z',
          lastActive: '2026-05-28T14:03:06Z',
          closed: false,
        },
      ],
    })
  })

  it('passes configured command timeouts to gc operations', async () => {
    const runner = createRecordingRunner([{ exitCode: 0, signal: null, stdout: 'routed\n', stderr: '' }])
    const adapter = new WaypointGasCityCliAdapter({ runner, timeoutMs: 1234 })

    await adapter.slingBead({ target: 'waypoint/codex', beadId: 'wpg-1', nudge: false })

    expect(runner.calls[0]).toMatchObject({
      command: 'gc',
      args: ['sling', 'waypoint/codex', 'wpg-1', '--no-formula'],
      timeoutMs: 1234,
    })
  })

  it('terminates spawned gc commands after the configured timeout', async () => {
    const runner = new SpawnWaypointGasCityCommandRunner()

    const output = await runner.run({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 50,
    })

    expect(output).toMatchObject({
      exitCode: null,
      signal: 'SIGTERM',
    })
    expect(output.stderr).toContain('Timed out after 50ms.')
  })
})

describe('diagnoseWaypointGasCityState', () => {
  it('detects missing route metadata, empty hooks, and stuck workers', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      expectedMoleculeId: 'wpg-9ay',
      task: {
        id: 'wpg-1',
        status: 'open',
        metadata: { waypoint: { route_id: 'route-001' } },
      },
      hookItems: [],
      sessions: [{ id: 'codex-creating-001', status: 'creating', target: 'waypoint/codex', ageSeconds: 900 }],
    })

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-route-metadata-missing',
      'gascity-hook-no-work',
      'gascity-worker-stuck-creating',
    ])
    expect(diagnostics[0]?.guidance.join('\n')).toContain('bd update wpg-1 --set-metadata gc.routed_to=waypoint/codex')
  })

  it('detects config drift drains and work stranded on drained sessions', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      task: {
        id: 'wpg-1',
        status: 'in_progress',
        assignee: 'codex-adhoc-20f62702ff',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
      hookItems: [],
      sessions: [
        {
          id: 'codex-adhoc-20f62702ff',
          status: 'drained',
          target: 'waypoint/codex',
          drainReason: 'config-drift',
        },
      ],
      events: [{ message: "Draining session 'codex-adhoc-20f62702ff': config-drift" }],
    })

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'gascity-worker-drained-config-drift',
      'gascity-work-stranded-on-drained-assignee',
    ])
  })

  it('warns instead of blocking on unrelated drained sessions', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      task: {
        id: 'wpg-1',
        status: 'in_progress',
        assignee: 'codex-ci-787',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
      sessions: [
        {
          id: 'unrelated-session',
          status: 'drained',
          target: 'maintenance',
          drainReason: 'config-drift',
        },
      ],
    })

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'gascity-worker-drained-config-drift',
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'gascity-work-assignee-not-in-session-list',
        severity: 'warning',
      }),
    ])
  })

  it('matches in-progress work to Gas City sessions by runtime identity fields', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      task: {
        id: 'wpg-1',
        status: 'in_progress',
        assignee: 'codex-ci-sal',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
      sessions: [
        {
          id: 'ci-sal',
          status: 'active',
          target: 'codex-ci-sal',
          template: 'waypoint/codex',
          sessionName: 'codex-ci-sal',
          agentName: 'waypoint/codex',
        },
      ],
    })

    expect(diagnostics).toEqual([])
  })

  it('warns instead of blocking when claimed work is absent from the session snapshot', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      task: {
        id: 'wpg-1',
        status: 'in_progress',
        assignee: 'codex-ci-787',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
      sessions: [],
    })

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'gascity-work-assignee-not-in-session-list',
        severity: 'warning',
      }),
    ])
  })

  it('warns instead of blocking on unscoped config-drift events', () => {
    const diagnostics = diagnoseWaypointGasCityState({
      expectedTarget: 'waypoint/codex',
      task: {
        id: 'wpg-1',
        status: 'in_progress',
        assignee: 'codex-ci-787',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      },
      sessions: [
        {
          id: 'codex-ci-787',
          status: 'active',
          sessionName: 'codex-ci-787',
        },
      ],
      events: [{ message: 'Unrelated session reported config-drift' }],
    })

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'gascity-worker-drained-config-drift',
        severity: 'warning',
      }),
    ])
  })
})

type FakeGasCityOutput = WaypointGasCityCommandOutput | Error

function createRecordingRunner(outputs: readonly FakeGasCityOutput[]): WaypointGasCityCommandRunner & {
  readonly calls: WaypointGasCityCommandInput[]
} {
  const calls: WaypointGasCityCommandInput[] = []
  return {
    calls,
    async run(input) {
      calls.push(input)
      const output = outputs[calls.length - 1] ?? outputs[outputs.length - 1]
      if (!output) throw new Error('No fake Gas City CLI output configured')
      if (output instanceof Error) throw output
      return output
    },
  }
}
