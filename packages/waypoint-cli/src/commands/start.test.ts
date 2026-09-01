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

describe('waypoint start command', () => {
  it('starts the selected Quest in an initialized folder', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-start-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))

    const { io, stdout, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['start', '--quest', 'runner'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Started run route-001')
    expect(output).toContain('quest: runner')
    expect(output).toContain('run backend: postgres')
    expect(output).toContain('current node: initialize')
    expect(output).toContain('scaffolded lifecycle: 1 workstream, 1 milestone, 6 phases, 12 plans')

    // Run state lives in postgres (P5): verify the persisted route and its
    // started event through the CLI read surface rather than disk YAML/JSONL.
    const routes = makeIo(cwd)
    expect(await runWaypointCli(['routes', '--json'], routes.io)).toBe(0)
    expect(JSON.parse(routes.stdout.join('\n'))).toMatchObject({
      routes: [{ id: 'route-001', quest: 'runner', current_node: 'initialize' }],
    })

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001', '--json'], events.io)).toBe(0)
    const parsedEvents = JSON.parse(events.stdout.join('\n')) as {
      total: number
      items: Array<Record<string, unknown>>
    }
    expect(parsedEvents.total).toBe(1)
    expect(parsedEvents.items[0]).toMatchObject({ kind: 'route.started', route_id: 'route-001' })
  })
})
