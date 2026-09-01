import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

function makeIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('waypoint handoffs command', () => {
  it('lists bundled handoff manifests as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      handoffs: Array<{ slug: string; name: string; handoff_count: number }>
    }
    expect(parsed.handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'example-review-handoffs',
          name: 'Example Review Handoffs',
          handoff_count: 2,
        }),
      ]),
    )
  })

  it('filters handoff manifests by quest as JSON (the scaffold declares none)', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--quest', 'runner', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      quest: string
      handoffs: Array<{ slug: string }>
    }
    expect(parsed.quest).toBe('runner')
    expect(parsed.handoffs).toEqual([])
  })

  it('resolves a WORKSPACE-authored quest for handoffs (workspace-aware, NB6)', async () => {
    // A workspace-authored quest (not in the bundle) that references a bundled
    // handoff manifest — only resolvable now that handoffs routes through the
    // workspace-aware loadCliCatalog.
    const root = await mkdtemp(join(tmpdir(), 'wp-handoffs-ws-'))
    try {
      const qDir = join(root, '.waypoint', 'quests')
      await mkdir(qDir, { recursive: true })
      await writeFile(
        join(qDir, 'authored-q.yaml'),
        'schema_version: 1\nslug: authored-q\nname: Authored Q\nworkflow: workflows/authored-q.md\nhandoff_manifests:\n  - example-review-handoffs\n',
        'utf8',
      )

      const stdout: string[] = []
      const stderr: string[] = []
      const code = await runWaypointCli(['handoffs', 'list', '--quest', 'authored-q', '--json'], {
        stdout: (l) => stdout.push(l),
        stderr: (l) => stderr.push(l),
        cwd: root,
      })

      expect(code).toBe(0)
      expect(stderr).toEqual([])
      const parsed = JSON.parse(stdout.join('\n')) as { quest: string; handoffs: Array<{ slug: string }> }
      expect(parsed.quest).toBe('authored-q')
      expect(parsed.handoffs.map((m) => m.slug)).toEqual(['example-review-handoffs'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prints a human-readable handoff manifest list', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Handoff graphs')
    expect(stdout.join('\n')).toContain('- example-review-handoffs: Example Review Handoffs (2 handoffs)')
  })

  it('shows a bundled handoff manifest as JSON', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'example-review-handoffs', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      slug: string
      handoffs: Array<{ slug: string; from: string; to: string; trigger: string; gate?: string; required_artifacts?: string[] }>
    }
    expect(parsed.slug).toBe('example-review-handoffs')
    expect(parsed.handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'worker-to-human-deliverable-review',
          from: 'worker',
          to: 'human-review',
          trigger: 'deliverable_ready',
          gate: 'human_review',
        }),
      ]),
    )
  })

  it('prints a human-readable handoff manifest detail view', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'example-review-handoffs'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Example Review Handoffs (example-review-handoffs)')
    expect(output).toContain('handoffs:')
    expect(output).toContain('- worker-to-human-deliverable-review: worker -> human-review')
    expect(output).toContain('trigger: deliverable_ready')
    expect(output).toContain('gate: human_review')
  })

  it('rejects unknown handoff manifests', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'show', 'missing-handoff-graph', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown handoff manifest: missing-handoff-graph')
  })

  it('rejects unknown quests when filtering handoffs', async () => {
    const { io, stdout, stderr } = makeIo()

    expect(await runWaypointCli(['handoffs', 'list', '--quest', 'missing-quest', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Unknown quest: missing-quest')
  })
})
