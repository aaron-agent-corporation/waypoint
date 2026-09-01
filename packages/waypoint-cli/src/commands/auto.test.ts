import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

const pgProjects = new PostgresTestProjects()

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
})

async function startedProject(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-auto-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint auto command', () => {
  it('runs null-runtime autopilot and stops on the first gate task', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '10'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Autopilot')
    expect(output).toContain('status: blocked')
    expect(output).toContain('iterations: 6')
    expect(output).toContain('blocked node: plan-approval-gate')
    expect(output).toContain('completed tasks: task-001, task-002, task-003, task-004, task-005')
  })

  it('lists autopilot run history', async () => {
    const cwd = await startedProject()
    const run = makeIo(cwd)
    expect(await runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '2'], run.io)).toBe(0)

    const { io, stdout, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['auto', 'status'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Autopilot runs')
    expect(output).toContain('total: 1')
    expect(output).toContain('- autopilot-run-001 route-001')
    expect(output).toContain('status: iteration_cap')
  })
})
