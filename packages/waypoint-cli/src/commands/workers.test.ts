import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initWaypointProject } from '@waypoint/folder-host'
import { runWorkersCommand } from './workers.ts'

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return { io: { cwd, stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) }, stdout, stderr }
}

describe('waypoint workers', () => {
  // Item 26: outside a project this used to die with six lines of Node
  // ENOENT internals; it degrades like `waypoint providers` instead.
  it('degrades to a one-liner outside a project', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'runner-workers-test-'))
    const { io, stdout } = makeIo(bare)

    const code = await runWorkersCommand([], io)

    expect(code).toBe(1)
    const out = stdout.join('\n')
    expect(out).toContain('Not a Waypoint project')
    expect(out).toContain(bare)
    expect(out).not.toContain('ENOENT')
  })

  it('degrades to a JSON error object with --json outside a project', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'runner-workers-test-'))
    const { io, stdout } = makeIo(bare)

    const code = await runWorkersCommand(['--json'], io)

    expect(code).toBe(1)
    const parsed = JSON.parse(stdout.join('\n'))
    expect(parsed.error).toContain('not a Waypoint project')
    expect(parsed.cwd).toBe(bare)
  })

  it('reports the single-worker pool inside a project with no lanes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runner-workers-test-'))
    await initWaypointProject(root, { quest: 'runner', backend: 'postgres' })
    const { io, stdout } = makeIo(root)

    const code = await runWorkersCommand([], io)

    expect(code).toBe(0)
    expect(stdout.join('\n')).toContain('no lanes configured')
  })
})
