import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
  await runWaypointCli(['init', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'waypoint'], { cwd, stdout: () => undefined, stderr: () => undefined })
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
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.checkpoint.completed')
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.task.simulated')
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.blocked')
  })

  it('blocks referral package autopilot when declared output artifacts are missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'waypoint-referral-autopilot-'))
    await runWaypointCli(['init', '--quest', 'referral-package'], { cwd, stdout: () => undefined, stderr: () => undefined })
    await runWaypointCli(['start', '--quest', 'referral-package'], { cwd, stdout: () => undefined, stderr: () => undefined })

    const result = await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 20 })

    expect(result.status).toBe('blocked')
    expect(result.blockedNode).toBe('medical-chronology-update')
    expect(result.completedTasks).not.toContain('task-006')

    const route = await getWaypointRoute(cwd, 'route-001')
    expect(route).toMatchObject({ status: 'blocked', current_node: 'medical-chronology-update' })

    const tasks = await listWaypointTasks(cwd)
    expect(tasks.find((task) => task.id === 'task-006')).toMatchObject({
      status: 'blocked',
      metadata: {
        waypoint: {
          missing_artifacts: expect.arrayContaining([
            '03-medical/medical-chronology-output/medical-chronology.html',
          ]),
        },
      },
    })

    const events = await readRouteEvents(cwd, 'route-001', { limit: 20 })
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.required_artifacts_missing')
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

  it('uses the configured local runtime when explicitly enabled', async () => {
    const cwd = await startedProject()
    const payloadPath = join(cwd, 'payload.json')
    const scriptPath = join(cwd, 'capture.mjs')
    await writeFile(
      join(cwd, '.waypoint', 'config.yaml'),
      `schema_version: 1\nenabled: true\nquest: waypoint\nruntime:\n  recipe: local\n  command: ${JSON.stringify(process.execPath)}\n  args:\n    - ${JSON.stringify(scriptPath)}\n    - ${JSON.stringify(payloadPath)}\ncreated_at: '2026-01-01T00:00:00.000Z'\nupdated_at: '2026-01-01T00:00:00.000Z'\n`,
      'utf8',
    )
    await writeFile(
      scriptPath,
      `import { writeFile } from 'node:fs/promises'\nlet input = ''\nfor await (const chunk of process.stdin) input += chunk\nawait writeFile(process.argv[2], input)\nconsole.log('ok')\n`,
      'utf8',
    )
    await chmod(scriptPath, 0o755)
    const result = await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 5 })

    expect(result.status).toBe('iteration_cap')
    await expect(readFile(payloadPath, 'utf8').then((raw) => JSON.parse(raw))).resolves.toMatchObject({
      recipe_slug: 'waypoint-phase-researcher',
      task_id: 'task-005',
      route_id: 'route-001',
      project_root: cwd,
    })
    const tasks = await listWaypointTasks(cwd)
    expect(tasks.find((task) => task.id === 'task-001')?.metadata?.waypoint).not.toMatchObject({ autopilot: { runtime: 'local' } })
    expect(tasks.find((task) => task.id === 'task-005')?.metadata?.waypoint).toMatchObject({ autopilot: { runtime: 'local', status: 'success' } })
  })

  it('records local runtime failure without corrupting route YAML', async () => {
    const cwd = await startedProject()
    const scriptPath = join(cwd, 'fail.mjs')
    await writeFile(
      join(cwd, '.waypoint', 'config.yaml'),
      `schema_version: 1\nenabled: true\nquest: waypoint\nruntime:\n  recipe: local\n  command: ${JSON.stringify(process.execPath)}\n  args:\n    - ${JSON.stringify(scriptPath)}\ncreated_at: '2026-01-01T00:00:00.000Z'\nupdated_at: '2026-01-01T00:00:00.000Z'\n`,
      'utf8',
    )
    await writeFile(scriptPath, `console.error('runtime exploded')\nprocess.exit(9)\n`, 'utf8')
    const result = await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 3 })

    expect(result.status).toBe('failed')
    const route = await getWaypointRoute(cwd, 'route-001')
    expect(route).toMatchObject({ status: 'failed', current_node: 'discuss-objective' })
    const tasks = await listWaypointTasks(cwd)
    expect(tasks.find((task) => task.id === 'task-001')?.status).toBe('done')
    expect(tasks.find((task) => task.id === 'task-003')?.status).toBe('failed')
    const events = await readRouteEvents(cwd, 'route-001', { limit: 20 })
    expect(events.items.map((event) => event.kind)).toContain('route.autopilot.task.failed')
  })
})
