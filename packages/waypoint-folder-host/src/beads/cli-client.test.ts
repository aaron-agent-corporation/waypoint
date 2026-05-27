import { describe, expect, it } from 'vitest'

import {
  WaypointBeadsCliCommandError,
  WaypointBeadsCliIssueClient,
  type WaypointBeadsCliCommandInput,
  type WaypointBeadsCliCommandOutput,
  type WaypointBeadsCliCommandRunner,
} from './cli-client.ts'
import type { WaypointBeadsMetadata } from './compiler.ts'

describe('WaypointBeadsCliIssueClient', () => {
  it('creates Beads issues with metadata, labels, parent, and configured command boundary', async () => {
    const runner = createRecordingRunner([{ exitCode: 0, signal: null, stdout: JSON.stringify({ id: 'bd-123' }), stderr: '' }])
    const client = new WaypointBeadsCliIssueClient({
      command: 'bd-test',
      cwd: '/tmp/project',
      globalArgs: ['--db', '/tmp/project/.beads/beads.db'],
      runner,
    })
    const metadata = waypointMetadata()

    const result = await client.createIssue({
      title: 'Draft demand package',
      description: 'Create the attorney-facing draft.',
      issueType: 'task',
      labels: ['waypoint', 'beads-runtime', 'quest:referral-package'],
      metadata,
      parent: 'bd-root',
    })

    expect(result).toEqual({ id: 'bd-123' })
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0]).toMatchObject({ command: 'bd-test', cwd: '/tmp/project' })
    expect(runner.calls[0]?.args).toEqual([
      '--db',
      '/tmp/project/.beads/beads.db',
      'create',
      'Draft demand package',
      '--description',
      'Create the attorney-facing draft.',
      '--type',
      'task',
      '--metadata',
      JSON.stringify(metadata),
      '--json',
      '--labels',
      'waypoint,beads-runtime,quest:referral-package',
      '--parent',
      'bd-root',
    ])
  })

  it('creates Beads dependencies through bd dep add', async () => {
    const runner = createRecordingRunner([
      { exitCode: 0, signal: null, stdout: JSON.stringify({ status: 'added' }), stderr: '' },
    ])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await client.addDependency({ dependent: 'bd-child', dependency: 'bd-parent', type: 'blocks' })

    expect(runner.calls[0]?.args).toEqual(['dep', 'add', 'bd-child', 'bd-parent', '--type', 'blocks', '--json'])
  })

  it('lists Waypoint Beads issue snapshots with dependencies', async () => {
    const metadata = waypointMetadata()
    const runner = createRecordingRunner([
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([
          {
            id: 'bd-parent',
            title: 'Parent',
            status: 'open',
            issue_type: 'task',
            metadata,
          },
          {
            id: 'bd-child',
            title: 'Child',
            status: 'open',
            issue_type: 'task',
            metadata,
            dependencies: [{ issue_id: 'bd-child', depends_on_id: 'bd-parent', type: 'blocks' }],
          },
        ]),
        stderr: '',
      },
    ])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await expect(client.listIssueSnapshots()).resolves.toMatchObject({
      issues: [
        { id: 'bd-parent', title: 'Parent', metadata },
        {
          id: 'bd-child',
          title: 'Child',
          dependencies: [{ issue_id: 'bd-child', depends_on_id: 'bd-parent', type: 'blocks' }],
        },
      ],
      dependencies: [{ issue_id: 'bd-child', depends_on_id: 'bd-parent', type: 'blocks' }],
    })
    expect(runner.calls[0]?.args).toEqual(['list', '--all', '--label', 'waypoint', '--json', '--limit', '0'])
  })

  it('lists Beads issue comments through bd comments', async () => {
    const runner = createRecordingRunner([
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([
          {
            id: 'comment-1',
            issue_id: 'bd-task',
            body: 'Waypoint discussion message\nauthor: user\n\nClarify the acceptance criteria.',
            actor: 'Aaron',
            created_at: '2026-05-27T12:00:00.000Z',
          },
        ]),
        stderr: '',
      },
    ])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await expect(client.listIssueComments('bd-task')).resolves.toEqual([
      {
        id: 'comment-1',
        issue_id: 'bd-task',
        text: 'Waypoint discussion message\nauthor: user\n\nClarify the acceptance criteria.',
        author: 'Aaron',
        created_at: '2026-05-27T12:00:00.000Z',
      },
    ])
    expect(runner.calls[0]?.args).toEqual(['comments', 'bd-task', '--json'])
  })

  it('mutates Beads issues for route transitions', async () => {
    const runner = createRecordingRunner([
      { exitCode: 0, signal: null, stdout: JSON.stringify({ status: 'closed' }), stderr: '' },
      { exitCode: 0, signal: null, stdout: JSON.stringify({ status: 'updated' }), stderr: '' },
      { exitCode: 0, signal: null, stdout: JSON.stringify({ status: 'commented' }), stderr: '' },
    ])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await client.closeIssue({ id: 'bd-gate', reason: 'Approved gate plan-review' })
    await client.updateIssueStatus({ id: 'bd-gate', status: 'blocked', note: 'Rejected gate plan-review' })
    await client.addIssueComment({ id: 'bd-gate', text: 'Waypoint gate decision recorded.' })

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['close', 'bd-gate', '--reason', 'Approved gate plan-review', '--json'],
      ['update', 'bd-gate', '--status', 'blocked', '--json', '--append-notes', 'Rejected gate plan-review'],
      ['comment', 'bd-gate', 'Waypoint gate decision recorded.', '--json'],
    ])
  })

  it('surfaces failed Beads commands with stderr, status, and redacted command context', async () => {
    const runner = createRecordingRunner([{ exitCode: 2, signal: null, stdout: '', stderr: 'bad metadata' }])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await expect(
      client.createIssue({
        title: 'Broken',
        description: 'Should fail',
        issueType: 'task',
        labels: [],
        metadata: waypointMetadata(),
      }),
    ).rejects.toMatchObject({
      name: 'WaypointBeadsCliCommandError',
      operation: 'create issue',
      exitCode: 2,
      stderr: 'bad metadata',
    })
    await expect(
      client.createIssue({
        title: 'Broken again',
        description: 'Should fail',
        issueType: 'task',
        labels: [],
        metadata: waypointMetadata(),
      }),
    ).rejects.toBeInstanceOf(WaypointBeadsCliCommandError)
  })

  it('rejects successful create responses that omit the issue id', async () => {
    const runner = createRecordingRunner([{ exitCode: 0, signal: null, stdout: JSON.stringify({ status: 'created' }), stderr: '' }])
    const client = new WaypointBeadsCliIssueClient({ runner })

    await expect(
      client.createIssue({
        title: 'Missing id',
        description: 'No id in output.',
        issueType: 'task',
        labels: [],
        metadata: waypointMetadata(),
      }),
    ).rejects.toThrow('did not return an issue id')
  })
})

function createRecordingRunner(outputs: readonly WaypointBeadsCliCommandOutput[]): WaypointBeadsCliCommandRunner & {
  readonly calls: WaypointBeadsCliCommandInput[]
} {
  const calls: WaypointBeadsCliCommandInput[] = []
  return {
    calls,
    async run(input) {
      calls.push(input)
      const output = outputs[calls.length - 1] ?? outputs[outputs.length - 1]
      if (!output) throw new Error('No fake Beads CLI output configured')
      return output
    },
  }
}

function waypointMetadata(): WaypointBeadsMetadata {
  return {
    waypoint: {
      schema_version: 1,
      kind: 'recipe',
      quest_slug: 'referral-package',
      route_id: 'route-001',
      node_key: 'draft-demand',
      recipe_slug: 'waypoint-doc-writer',
      subject: { type: 'folder', id: 'case-001' },
      source: { quest_path: 'quests/referral-package.yaml', recipe_path: 'recipes/waypoint/doc-writer.yaml' },
      policy: { external_side_effects: 'forbidden' },
    },
  }
}
