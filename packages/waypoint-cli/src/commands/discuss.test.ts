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
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-discuss-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint discuss command', () => {
  it('appends and lists task-scoped discussion messages', async () => {
    const cwd = await startedProject()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['discuss', '--task-id', 'task-003', '--message', 'Need acceptance criteria'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Discussion task-003')
    expect(output).toContain('conversation: task:3:discussion:scaffold-discussion')
    expect(output).toContain('- message-001 user')
    expect(output).toContain('Need acceptance criteria')
    expect(output).toContain('auto_response: requested=false reason=global_disabled agent=scaffold-discussion')
  })

  it('records agent-authored messages without recursive auto-response', async () => {
    const cwd = await startedProject()
    const { io, stdout } = makeIo(cwd)

    expect(
      await runWaypointCli(['discuss', '--task-id', 'task-003', '--author', 'agent', '--message', 'Agent reply'], io),
    ).toBe(0)
    expect(stdout.join('\n')).toContain('auto_response: requested=false reason=agent_authored agent=scaffold-discussion')
  })
})
