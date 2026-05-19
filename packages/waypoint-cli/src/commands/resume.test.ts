import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { updateWaypointRoute } from '../../../waypoint-folder-host/src/routes/store.ts'
import { updateWaypointTask } from '../../../waypoint-folder-host/src/tasks/store.ts'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-resume-'))
  await runWaypointCli(['init', '--quest', 'referral-package'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'referral-package'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await updateWaypointRoute(cwd, 'route-001', { status: 'blocked', current_node: 'start-here-draft' })
  await updateWaypointTask(cwd, 'task-008', {
    status: 'blocked',
    metadata: {
      waypoint: {
        output_artifacts: [{ path: 'referral-package-build/attorney-handoff/START_HERE.html' }],
        missing_artifacts: ['referral-package-build/attorney-handoff/START_HERE.html'],
        block_reason: 'required_artifacts_missing',
      },
    },
  })
  return cwd
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

describe('waypoint resume command', () => {
  it('accepts a resolved blocker input and reopens the blocked task for autopilot resume', async () => {
    const cwd = await startedProject()
    await mkdir(join(cwd, 'referral-package-build/attorney-handoff'), { recursive: true })
    await writeFile(join(cwd, 'referral-package-build/attorney-handoff/START_HERE.html'), '<html>done</html>', 'utf8')
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['resume', '--route-id', 'route-001', '--resolve-blocker', '--note', 'Paralegal completed the medical chronology/package artifact'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Resolved blocker for route route-001')
    expect(stdout.join('\n')).toContain('current node: start-here-draft')
  })
})
