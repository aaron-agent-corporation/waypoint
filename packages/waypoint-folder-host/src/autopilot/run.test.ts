import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getWaypointRoute } from '../routes/store.ts'
import { readRouteEvents } from '../events/jsonl.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import { PostgresTestProjects } from '../testing/postgres.ts'
import { runWaypointCli } from '../../../waypoint-cli/src/bin.ts'
import { autopilotRuntimeExecutes, runWaypointAutopilot, listWaypointAutopilotRuns } from './run.ts'

const pgProjects = new PostgresTestProjects()

beforeAll(() => pgProjects.setEnv())
afterAll(async () => {
  await pgProjects.cleanup()
})

// Autopilot drives plain-postgres projects; durable (engine-driven) projects
// refuse `waypoint auto`, so every init here passes --postgres-no-durable.
async function startedProject(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('runner-autopilot-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], { cwd, stdout: () => undefined, stderr: () => undefined })
  await runWaypointCli(['start', '--quest', 'runner'], { cwd, stdout: () => undefined, stderr: () => undefined })
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
      `schema_version: 1\nenabled: true\nquest: runner\nruntime:\n  recipe: local\n  command: ${JSON.stringify(process.execPath)}\n  args:\n    - ${JSON.stringify(scriptPath)}\n    - ${JSON.stringify(payloadPath)}\ncreated_at: '2026-01-01T00:00:00.000Z'\nupdated_at: '2026-01-01T00:00:00.000Z'\n`,
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
      // The scaffold's only dispatch since D6 (2026-08-24) is the discuss
      // step's conversation; the coding agents this used to reach are gone.
      recipe_slug: 'scaffold-discussion',
      task_id: 'task-003',
      route_id: 'route-001',
      project_root: cwd,
    })
    const tasks = await listWaypointTasks(cwd)
    expect(tasks.find((task) => task.id === 'task-001')?.metadata?.runner).not.toMatchObject({ autopilot: { runtime: 'local' } })
    expect(tasks.find((task) => task.id === 'task-003')?.metadata?.runner).toMatchObject({ autopilot: { runtime: 'local', status: 'finished' } })
  })

  it('feeds the failed attempt’s evidence into the retry work order (rsc-f3v)', async () => {
    const cwd = await startedProject()
    const scriptPath = join(cwd, 'fake-agent.mjs')
    const wrapperPath = join(cwd, 'fake-agent')
    await writeFile(wrapperPath, `#!/bin/sh\nexec ${process.execPath} ${scriptPath} "$@"\n`, 'utf8')
    await chmod(wrapperPath, 0o755)
    await writeFile(
      join(cwd, '.waypoint', 'config.yaml'),
      `schema_version: 1\nenabled: true\nquest: runner\nruntime:\n  recipe: worker\n  worker:\n    command: ${JSON.stringify(wrapperPath)}\ncreated_at: '2026-01-01T00:00:00.000Z'\nupdated_at: '2026-01-01T00:00:00.000Z'\n`,
      'utf8',
    )
    // First attempt: the agent itself explodes → the task fails with real stderr.
    await writeFile(scriptPath, `process.stdin.resume()\nprocess.stdin.on('end', () => { console.error('agent exploded: no such model'); process.exit(2) })\n`, 'utf8')
    const firstRun = await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 5 })
    expect(firstRun.status).toBe('failed')
    const failed = (await listWaypointTasks(cwd)).find((task) => task.status === 'failed')
    expect(failed).toBeDefined()

    // Operator retry via the CLI verb: flips the task open and announces the
    // evidence carry-over.
    const retryStdout: string[] = []
    const exit = await runWaypointCli(['tasks', 'retry', '--task-id', failed!.id], {
      cwd,
      stdout: (line) => retryStdout.push(line),
      stderr: () => undefined,
    })
    expect(exit).toBe(0)
    expect(retryStdout.join('\n')).toContain('carry the failed attempt’s evidence')

    // Second attempt: the agent captures the work order it received on stdin —
    // the retry frame must carry the prior attempt's evidence verbatim.
    await writeFile(
      scriptPath,
      [
        `import { appendFile } from 'node:fs/promises'`,
        `let stdin = ''`,
        `for await (const chunk of process.stdin) stdin += chunk`,
        `await appendFile(${JSON.stringify(join(cwd, 'work-order.txt'))}, stdin)`,
      ].join('\n'),
      'utf8',
    )
    await runWaypointAutopilot(cwd, { routeId: 'route-001', maxIterations: 1 })

    const workOrder = await readFile(join(cwd, 'work-order.txt'), 'utf8')
    expect(workOrder).toContain('## Prior attempt (this is a retry)')
    expect(workOrder).toContain('agent exploded: no such model')
  })

  it('records local runtime failure without corrupting route state', async () => {
    const cwd = await startedProject()
    const scriptPath = join(cwd, 'fail.mjs')
    await writeFile(
      join(cwd, '.waypoint', 'config.yaml'),
      `schema_version: 1\nenabled: true\nquest: runner\nruntime:\n  recipe: local\n  command: ${JSON.stringify(process.execPath)}\n  args:\n    - ${JSON.stringify(scriptPath)}\ncreated_at: '2026-01-01T00:00:00.000Z'\nupdated_at: '2026-01-01T00:00:00.000Z'\n`,
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

describe('autopilot runtime labels (rsc-p8y)', () => {
  it('worker executes for real — recorded executed, never simulated', () => {
    expect(autopilotRuntimeExecutes('local')).toBe(true)
    expect(autopilotRuntimeExecutes('worker')).toBe(true)
    expect(autopilotRuntimeExecutes('null')).toBe(false)
  })
})
