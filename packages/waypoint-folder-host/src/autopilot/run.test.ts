import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getWaypointRoute } from '../routes/store.ts'
import { readRouteEvents } from '../events/jsonl.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import { runWaypointCli } from '../../../waypoint-cli/src/bin.ts'
import { runWaypointAutopilot, listWaypointAutopilotRuns } from './run.ts'

async function startedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'waypoint-autopilot-'))
  await runWaypointCli(['init', '--quest', 'gsd'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'gsd'], { cwd, stdout: () => undefined, stderr: () => undefined })
  return cwd
}

describe('folder host autopilot', () => {
  it('simulates recipe and discussion tasks until it reaches a human gate', async () => {
    const cwd = await startedProject()

    const result = await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 10 })

    expect(result.status).toBe('blocked')
    expect(result.iterations).toBe(6)
    expect(result.blockedNode).toBe('plan-approval-gate')
    expect(result.completedTasks).toEqual(['task-001', 'task-002', 'task-003', 'task-004', 'task-005'])

    const route = await getWaypointRoute(cwd, 'route-001')
    expect(route?.status).toBe('blocked')
    expect(route?.current_node).toBe('plan-approval-gate')

    const tasks = await listWaypointTasks(cwd)
    expect(tasks.find((task) => task.id === 'task-001')?.status).toBe('done')
    expect(tasks.find((task) => task.id === 'task-006')?.status).toBe('blocked')

    const events = await readRouteEvents(cwd, 'route-001', { limit: 20 })
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.task.simulated')
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.blocked')
  })

  it('persists autopilot run history', async () => {
    const cwd = await startedProject()

    await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 3 })
    const history = await listWaypointAutopilotRuns(cwd)

    expect(history.total).toBe(1)
    expect(history.items[0]).toMatchObject({
      id: 'autopilot-run-001',
      route_id: 'route-001',
      status: 'iteration_cap',
      iterations: 3,
    })
  })
})
