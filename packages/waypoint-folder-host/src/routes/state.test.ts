import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { appendRouteEvent, readRouteEvents } from '../events/jsonl'
import { updateWaypointTask } from '../tasks/store'
import type { WaypointFolderTask } from '../tasks/types'
import { createWaypointRoute, getWaypointRoute, updateWaypointRoute } from './store'
import { approveRouteGate, pauseWaypointRoute, rejectRouteGate, resolveWaypointRouteBlocker, resumeWaypointRoute } from './state'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-route-state-'))
}

async function createRoute(projectRoot: string) {
  return createWaypointRoute(projectRoot, {
    quest: 'waypoint',
    current_node: 'human_plan_gate',
    subject: { type: 'project', id: 'local' },
    now: new Date('2026-05-07T16:30:00.000Z'),
  })
}

async function writeTaskState(projectRoot: string, tasks: WaypointFolderTask[]): Promise<void> {
  await mkdir(join(projectRoot, '.waypoint', 'tasks'), { recursive: true })
  await writeFile(join(projectRoot, '.waypoint', 'tasks', 'tasks.yaml'), JSON.stringify({ schema_version: 1, tasks }), 'utf8')
}

async function writeRequiredArtifact(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, 'referral-package-build', 'attorney-handoff'), { recursive: true })
  await writeFile(join(projectRoot, 'referral-package-build', 'attorney-handoff', 'START_HERE.html'), '<html>resolved</html>', 'utf8')
}

async function createBlockedGateRoute(projectRoot: string) {
  const route = await createWaypointRoute(projectRoot, {
    quest: 'waypoint',
    current_node: 'human_plan_gate',
    status: 'blocked',
    subject: { type: 'project', id: 'local' },
    now: new Date('2026-05-07T16:30:00.000Z'),
  })
  await writeTaskState(projectRoot, [
    {
      id: 'task-gate-001',
      route_id: route.id,
      plan_ref: 'human_plan_gate',
      title: 'Human plan gate',
      phase: 'planning',
      wave: 1,
      kind: 'gate',
      status: 'blocked',
      created_at: '2026-05-07T16:30:00.000Z',
      updated_at: '2026-05-07T16:30:00.000Z',
    },
  ])
  return route
}

describe('route state controls', () => {
  it('approves a gate, advances the current node, and appends an event', async () => {
    const projectRoot = await tempProject()
    const route = await createBlockedGateRoute(projectRoot)

    const updated = await approveRouteGate(projectRoot, {
      routeId: route.id,
      node: 'human_plan_gate',
      note: 'Plan accepted',
      nextNode: 'execute',
      now: new Date('2026-05-07T16:31:00.000Z'),
    })

    expect(updated).toMatchObject({ id: 'route-001', status: 'active', current_node: 'execute' })
    expect(await getWaypointRoute(projectRoot, route.id)).toMatchObject({ status: 'active', current_node: 'execute' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items).toHaveLength(1)
    expect(events.items[0]).toMatchObject({
      id: 'event-001',
      route_id: 'route-001',
      kind: 'route.gate.approved',
      payload: { node: 'human_plan_gate', note: 'Plan accepted', previous_node: 'human_plan_gate', next_node: 'execute' },
    })
  })

  it('rejects a gate, blocks the route, and records the note', async () => {
    const projectRoot = await tempProject()
    const route = await createBlockedGateRoute(projectRoot)

    const updated = await rejectRouteGate(projectRoot, {
      routeId: route.id,
      node: 'human_plan_gate',
      note: 'Plan needs work',
      now: new Date('2026-05-07T16:32:00.000Z'),
    })

    expect(updated).toMatchObject({ id: 'route-001', status: 'blocked', current_node: 'human_plan_gate' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items[0]).toMatchObject({
      kind: 'route.gate.rejected',
      payload: { node: 'human_plan_gate', note: 'Plan needs work', previous_node: 'human_plan_gate' },
    })
  })

  it('approveRouteGate throws when node is not the current blocked gate', async () => {
    const projectRoot = await tempProject()
    const route = await createBlockedGateRoute(projectRoot)

    await expect(
      approveRouteGate(projectRoot, {
        routeId: route.id,
        node: 'some_other_gate',
        note: 'Stale click',
        now: new Date('2026-05-07T16:31:00.000Z'),
      }),
    ).rejects.toThrow(/gate\.decide.*some_other_gate.*not the current blocked gate/)

    // Route must remain untouched
    const current = await getWaypointRoute(projectRoot, route.id)
    expect(current).toMatchObject({ status: 'blocked', current_node: 'human_plan_gate' })
    // No events appended
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.filter((e) => e.kind === 'route.gate.approved')).toHaveLength(0)
  })

  it('rejectRouteGate throws when node is not the current blocked gate', async () => {
    const projectRoot = await tempProject()
    const route = await createBlockedGateRoute(projectRoot)

    await expect(
      rejectRouteGate(projectRoot, {
        routeId: route.id,
        node: 'some_other_gate',
        note: 'Stale click',
        now: new Date('2026-05-07T16:32:00.000Z'),
      }),
    ).rejects.toThrow(/gate\.decide.*some_other_gate.*not the current blocked gate/)

    // Route must remain untouched
    const current = await getWaypointRoute(projectRoot, route.id)
    expect(current).toMatchObject({ status: 'blocked', current_node: 'human_plan_gate' })
    // No events appended
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.filter((e) => e.kind === 'route.gate.rejected')).toHaveLength(0)
  })

  it('pauses and resumes a route with append-only events', async () => {
    const projectRoot = await tempProject()
    const route = await createRoute(projectRoot)
    await appendRouteEvent(projectRoot, route.id, { kind: 'route.started', now: new Date('2026-05-07T16:30:01.000Z') })

    await pauseWaypointRoute(projectRoot, {
      routeId: route.id,
      reason: 'Waiting on review',
      now: new Date('2026-05-07T16:33:00.000Z'),
    })
    const resumed = await resumeWaypointRoute(projectRoot, {
      routeId: route.id,
      now: new Date('2026-05-07T16:34:00.000Z'),
    })

    expect(resumed).toMatchObject({ id: 'route-001', status: 'active' })
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.map((event) => event.kind)).toEqual(['route.started', 'route.paused', 'route.resumed'])
    expect(events.items[1]).toMatchObject({ payload: { reason: 'Waiting on review', previous_status: 'active' } })
    expect(events.items[2]).toMatchObject({ payload: { previous_status: 'blocked' } })
  })

  it('resolves a required artifact blocker after the missing artifact exists', async () => {
    const projectRoot = await tempProject()
    const route = await createRoute(projectRoot)
    await updateWaypointRoute(projectRoot, route.id, { status: 'blocked', current_node: 'start-here-draft' })
    await writeTaskState(projectRoot, [
      {
        id: 'task-001',
        route_id: route.id,
        plan_ref: 'start-here-draft',
        title: 'Draft START_HERE dashboard',
        phase: 'handoff',
        wave: 1,
        kind: 'recipe',
        status: 'blocked',
        created_at: '2026-05-07T16:30:00.000Z',
        updated_at: '2026-05-07T16:30:00.000Z',
        metadata: {
          waypoint: {
            output_artifacts: [{ path: 'referral-package-build/attorney-handoff/START_HERE.html' }],
            missing_artifacts: ['referral-package-build/attorney-handoff/START_HERE.html'],
            block_reason: 'required_artifacts_missing',
          },
        },
      },
    ])

    await expect(
      resolveWaypointRouteBlocker(projectRoot, {
        routeId: route.id,
        note: 'Paralegal finished the missing package artifact',
        now: new Date('2026-05-07T16:35:00.000Z'),
      }),
    ).rejects.toThrow(/Missing required artifacts/)

    await writeRequiredArtifact(projectRoot)
    const resolved = await resolveWaypointRouteBlocker(projectRoot, {
      routeId: route.id,
      note: 'Paralegal finished the missing package artifact',
      now: new Date('2026-05-07T16:36:00.000Z'),
    })

    expect(resolved).toMatchObject({ status: 'active', current_node: 'start-here-draft' })
    const task = await updateWaypointTask(projectRoot, 'task-001', {})
    expect(task).toMatchObject({ status: 'open' })
    expect(task.metadata?.waypoint).not.toHaveProperty('missing_artifacts')
    expect(task.metadata?.waypoint).not.toHaveProperty('block_reason')
    const events = await readRouteEvents(projectRoot, route.id)
    expect(events.items.at(-1)).toMatchObject({
      kind: 'route.blocker.resolved',
      payload: {
        task_id: 'task-001',
        node: 'start-here-draft',
        note: 'Paralegal finished the missing package artifact',
      },
    })
  })
})
