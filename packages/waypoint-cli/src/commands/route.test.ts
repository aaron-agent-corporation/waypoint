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
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-route-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint route command', () => {
  it('prints full route summary for a route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route', '--route-id', 'route-001'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Run route-001')
    expect(output).toContain('quest: runner')
    expect(output).toContain('status: active')
    expect(output).toContain('current node: initialize')
    expect(output).toContain('subject: project/local')
    expect(output).toContain('created_at:')
    expect(output).toContain('updated_at:')
  })

  it('returns a non-zero exit code for a missing route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route', '--route-id', 'route-999'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Route not found: route-999')
  })
})
