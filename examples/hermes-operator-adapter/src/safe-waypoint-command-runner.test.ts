import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { HermesProjectRecord } from './project-registry.ts'
import {
  buildSafeWaypointCommand,
  runSafeWaypointCommand,
  type WaypointCommandExecutor,
} from './safe-waypoint-command-runner.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')

function projectRecord(path: string): HermesProjectRecord {
  return {
    name: 'waypoint',
    path,
    waypointCli,
  }
}

describe('safe Waypoint command runner', () => {
  it('builds only allowlisted Waypoint commands for a registered project', () => {
    const project = projectRecord('/tmp/waypoint-project')

    expect(buildSafeWaypointCommand(project, ['status'])).toEqual({
      command: process.execPath,
      args: [waypointCli, 'status'],
      cwd: '/tmp/waypoint-project',
      mutation: false,
      summaryHint: 'status',
    })

    expect(buildSafeWaypointCommand(project, ['route-events', '--route-id', 'route-001', '--limit', '20']).args).toEqual([
      waypointCli,
      'route-events',
      '--route-id',
      'route-001',
      '--limit',
      '20',
    ])
  })

  it('allows Hermes to inspect catalog options and start a selected Quest with explicit args', () => {
    const project = projectRecord('/tmp/waypoint-project')

    expect(buildSafeWaypointCommand(project, ['quests', '--json'])).toMatchObject({
      args: [waypointCli, 'quests', '--json'],
      cwd: '/tmp/waypoint-project',
      mutation: false,
      summaryHint: 'quests',
    })
    expect(buildSafeWaypointCommand(project, ['recipes', '--quest', 'agentic-delivery', '--json'])).toMatchObject({
      args: [waypointCli, 'recipes', '--quest', 'agentic-delivery', '--json'],
      cwd: '/tmp/waypoint-project',
      mutation: false,
      summaryHint: 'recipes',
    })
    expect(buildSafeWaypointCommand(project, ['init', '--quest', 'agentic-delivery'])).toMatchObject({
      args: [waypointCli, 'init', '--quest', 'agentic-delivery'],
      cwd: '/tmp/waypoint-project',
      mutation: true,
      summaryHint: 'init',
    })
    expect(buildSafeWaypointCommand(project, ['start', '--quest', 'agentic-delivery', '--json'])).toMatchObject({
      args: [waypointCli, 'start', '--quest', 'agentic-delivery', '--json'],
      cwd: '/tmp/waypoint-project',
      mutation: true,
      summaryHint: 'start',
    })
  })

  it('fails closed for shell commands, unknown Waypoint commands, and disallowed flags', () => {
    const project = projectRecord('/tmp/waypoint-project')

    expect(() => buildSafeWaypointCommand(project, ['sh', '-c', 'rm -rf .waypoint'])).toThrow(
      'Waypoint command is not allowlisted: sh',
    )
    expect(() => buildSafeWaypointCommand(project, ['status', '--exec', 'rm -rf .'])).toThrow(
      'Waypoint status does not allow flag: --exec',
    )
    expect(() => buildSafeWaypointCommand(project, ['start', '--quest', '../bad'])).toThrow(
      'Waypoint start does not allow unsafe Quest slug: ../bad',
    )
    expect(() => buildSafeWaypointCommand(project, ['route', '--route-id'])).toThrow(
      'Waypoint route requires a value for --route-id',
    )
  })

  it('marks mutation commands explicitly while still requiring clear command intent', () => {
    const project = projectRecord('/tmp/waypoint-project')

    expect(buildSafeWaypointCommand(project, ['discuss', '--task-id', 'task-003', '--message', 'Need review']).mutation).toBe(
      true,
    )
    expect(
      buildSafeWaypointCommand(project, [
        'gate',
        '--route-id',
        'route-001',
        '--node',
        'plan-approval-gate',
        '--approve',
        '--next-node',
        'execute',
      ]).mutation,
    ).toBe(true)
    expect(() => buildSafeWaypointCommand(project, ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate'])).toThrow(
      'Waypoint gate requires exactly one of --approve or --reject',
    )
    expect(() => buildSafeWaypointCommand(project, ['pause', '--route-id', 'route-001', '--reason'])).toThrow(
      'Waypoint pause requires a value for --reason',
    )
  })

  it('allowlists only safe FirmVault document intake and handoff commands', () => {
    const project = projectRecord('/trusted/firmvault/cases/jane-smith-v-acme-trucking')

    expect(buildSafeWaypointCommand(project, [
      'firmvault',
      'add-document',
      '--source',
      '/trusted/scans/daily-mail.pdf',
      '--kind',
      'unknown',
      '--note',
      'Daily Mail scan',
      '--json',
    ])).toEqual({
      command: process.execPath,
      args: [
        waypointCli,
        'firmvault',
        'add-document',
        '--source',
        '/trusted/scans/daily-mail.pdf',
        '--kind',
        'unknown',
        '--note',
        'Daily Mail scan',
        '--json',
      ],
      cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      mutation: true,
      summaryHint: 'firmvault add-document',
    })
    expect(buildSafeWaypointCommand(project, [
      'firmvault',
      'document-handoff',
      '--document-id',
      'document-001',
      '--status',
      'pr-opened',
      '--pr-number',
      '123',
      '--json',
    ])).toMatchObject({
      args: [waypointCli, 'firmvault', 'document-handoff', '--document-id', 'document-001', '--status', 'pr-opened', '--pr-number', '123', '--json'],
      cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      mutation: true,
      summaryHint: 'firmvault document-handoff',
    })

    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'add-document', '--source', 'relative.pdf', '--kind', 'unknown'])).toThrow(
      'Waypoint firmvault add-document requires --source to be absolute',
    )
    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'add-document', '--source', '/trusted/scans/daily-mail.pdf', '--kind', 'bad'])).toThrow(
      'Waypoint firmvault add-document does not allow document kind: bad',
    )
    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'document-handoff', '--document-id', 'document-001', '--status', 'bogus'])).toThrow(
      'Waypoint firmvault document-handoff does not allow status: bogus',
    )
  })

  it('allowlists safe FirmVault legal state commands for paralegal operation', () => {
    const project = projectRecord('/trusted/firmvault/cases/jane-smith-v-acme-trucking')

    expect(buildSafeWaypointCommand(project, ['firmvault', 'state', 'show', '--section', 'demand', '--json'])).toMatchObject({
      args: [waypointCli, 'firmvault', 'state', 'show', '--section', 'demand', '--json'],
      cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      mutation: false,
      summaryHint: 'firmvault state show',
    })
    expect(buildSafeWaypointCommand(project, [
      'firmvault',
      'state',
      'set',
      '--fact',
      'demand.send',
      '--status',
      'sent',
      '--evidence',
      'documents/sent/demand.md',
      '--note',
      'Sent by human after attorney approval.',
      '--json',
    ])).toMatchObject({
      args: [
        waypointCli,
        'firmvault',
        'state',
        'set',
        '--fact',
        'demand.send',
        '--status',
        'sent',
        '--evidence',
        'documents/sent/demand.md',
        '--note',
        'Sent by human after attorney approval.',
        '--json',
      ],
      cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      mutation: true,
      summaryHint: 'firmvault state set',
    })
    expect(buildSafeWaypointCommand(project, ['firmvault', 'evidence', 'check', '--path', 'documents/sent/demand.md', '--json'])).toMatchObject({
      args: [waypointCli, 'firmvault', 'evidence', 'check', '--path', 'documents/sent/demand.md', '--json'],
      cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      mutation: false,
      summaryHint: 'firmvault evidence check',
    })
    expect(buildSafeWaypointCommand(project, ['firmvault', 'landmarks', '--json'])).toMatchObject({
      args: [waypointCli, 'firmvault', 'landmarks', '--json'],
      mutation: false,
      summaryHint: 'firmvault landmarks',
    })

    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'state', 'set', '--status', 'sent'])).toThrow(
      'Waypoint firmvault state set requires --fact',
    )
    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'state', 'set', '--fact', 'demand.send', '--status', 'sent', '--evidence', '../demand.md'])).toThrow(
      'Waypoint firmvault state set requires --evidence to be a safe relative path: ../demand.md',
    )
    expect(() => buildSafeWaypointCommand(project, ['firmvault', 'evidence', 'check', '--path', '/tmp/demand.md'])).toThrow(
      'Waypoint firmvault evidence check requires --path to be a safe relative path: /tmp/demand.md',
    )
  })

  it('runs an allowlisted command through an injected executor and preserves IDs in output', async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: WaypointCommandExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      return {
        exitCode: 0,
        stdout: 'Waypoint routes\n- route-001\n  status: blocked\n',
        stderr: '',
      }
    }

    const result = await runSafeWaypointCommand(projectRecord('/tmp/waypoint-project'), ['routes'], { executor })

    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      stdout: 'Waypoint routes\n- route-001\n  status: blocked\n',
      stderr: '',
      command: 'waypoint routes',
      mutation: false,
      summaryHint: 'routes',
    })
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [waypointCli, 'routes'],
        cwd: '/tmp/waypoint-project',
      },
    ])
  })

  it('can operate a real initialized folder-host project through the allowlisted runner', async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-runner-'))
    try {
      const setupProject = projectRecord(projectRoot)
      await runSafeWaypointCommand(setupProject, ['status'])

      const status = await runSafeWaypointCommand(setupProject, ['status'])

      expect(status.ok).toBe(true)
      expect(status.stdout).toContain('Waypoint project status')
      expect(status.stdout).toContain('initialized: false')
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})
