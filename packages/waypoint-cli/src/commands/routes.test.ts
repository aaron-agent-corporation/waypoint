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

async function initializedProjectWithRoute(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-routes-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint routes command', () => {
  it('lists active route id, status, quest, and current node', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['routes'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Runs')
    expect(output).toContain('total: 1')
    expect(output).toContain('- route-001')
    expect(output).toContain('status: active')
    expect(output).toContain('quest: runner')
    expect(output).toContain('current node: initialize')
  })

  it('can emit route list as JSON', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['routes', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      routes: [
        {
          id: 'route-001',
          status: 'active',
          quest: 'runner',
          current_node: 'initialize',
          // No attempt is in flight on a freshly started plain route; the
          // field's presence is what consumers key the retrying-vs-stopped
          // distinction on.
          current_node_attempt_running: false,
        },
      ],
    })
  })
})
