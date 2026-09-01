import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'
import { updateWaypointRoute } from '../../../waypoint-folder-host/src/routes/store.ts'
import { listWaypointTasks, updateWaypointTask } from '../../../waypoint-folder-host/src/tasks/store.ts'

const pgProjects = new PostgresTestProjects()

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
})

async function startedProject(): Promise<{ cwd: string; node: string }> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-resume-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  const tasks = await listWaypointTasks(cwd)
  const task = tasks.find((entry) => entry.route_id === 'route-001')
  if (!task) throw new Error('expected a materialized task for route-001')
  await updateWaypointRoute(cwd, 'route-001', { status: 'blocked', current_node: task.plan_ref })
  await updateWaypointTask(cwd, task.id, {
    status: 'blocked',
    metadata: {
      runner: {
        output_artifacts: [{ path: 'build/output/RESULT.md' }],
        missing_artifacts: ['build/output/RESULT.md'],
        block_reason: 'required_artifacts_missing',
      },
    },
  })
  return { cwd, node: task.plan_ref }
}

describe('waypoint resume command', () => {
  it('accepts a resolved blocker input and reopens the blocked task for autopilot resume', async () => {
    const { cwd, node } = await startedProject()
    await mkdir(join(cwd, 'build/output'), { recursive: true })
    await writeFile(join(cwd, 'build/output/RESULT.md'), '# done\n', 'utf8')
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['resume', '--route-id', 'route-001', '--resolve-blocker', '--note', 'Operator produced the missing artifact'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('Resolved blocker for run route-001')
    expect(stdout.join('\n')).toContain(`current node: ${node}`)
  })
})
