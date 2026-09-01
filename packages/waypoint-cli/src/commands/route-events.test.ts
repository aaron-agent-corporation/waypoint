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
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-route-events-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint route-events command', () => {
  it('prints paginated route events for a route id', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--limit', '10', '--offset', '0'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Run events route-001')
    expect(output).toContain('total: 1')
    expect(output).toContain('limit: 10')
    expect(output).toContain('offset: 0')
    expect(output).toContain('- event-001 route.started')
  })

  it('can emit route events as JSON', async () => {
    const cwd = await initializedProjectWithRoute()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({
      route_id: 'route-001',
      total: 1,
      items: [{ id: 'event-001', kind: 'route.started', route_id: 'route-001' }],
    })
  })
})
