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
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-gate-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

/**
 * Gate decisions target the route's CURRENT node only (stale-click guard in
 * routes/state.ts), so the route must actually reach the gate first: autopilot
 * simulates the runner quest's early tasks and blocks at plan-approval-gate.
 */
async function projectAtPlanGate(): Promise<string> {
  const cwd = await startedProject()
  await runWaypointCli(['auto', '--route-id', 'route-001'], silentIo(cwd))
  return cwd
}

describe('waypoint gate command', () => {
  it('approves a gate and appends a gate-approved event', async () => {
    const cwd = await projectAtPlanGate()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--approve', '--note', 'Plan accepted'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Approved gate plan-approval-gate on run route-001')
    expect(output).toContain('status: active')
    expect(output).toContain('note: Plan accepted')

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001'], events.io)).toBe(0)
    expect(events.stdout.join('\n')).toContain('route.gate.approved')
  })

  it('rejects a gate and surfaces blocked gate count in status', async () => {
    const cwd = await projectAtPlanGate()
    const { io, stdout, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(
        ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--reject', '--note', 'Plan needs work'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Rejected gate plan-approval-gate on run route-001')
    expect(output).toContain('status: blocked')

    const status = makeIo(cwd)
    expect(await runWaypointCli(['status'], status.io)).toBe(0)
    expect(status.stdout.join('\n')).toContain('blocked gates: 1')
  })

  it('refuses to decide a gate the route has not reached', async () => {
    const cwd = await startedProject()
    const { io, stderr } = makeIo(cwd)

    expect(
      await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--approve'], io),
    ).toBe(1)
    expect(stderr.join('\n')).toContain('not the current gate')
  })

  it('requires exactly one gate decision', async () => {
    const cwd = await startedProject()
    const { io, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate'], io)).toBe(1)
    expect(stderr.join('\n')).toContain('Exactly one of --approve, --reject, or --show is required')
  })
})
