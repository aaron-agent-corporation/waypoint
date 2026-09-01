import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { startQuestRoute } from '../routes/start'
import { PostgresTestProjects } from '../testing/postgres'
import { getWaypointTask, listWaypointTasks, updateWaypointTask } from './store'

const pgProjects = new PostgresTestProjects()

async function startedProject(): Promise<string> {
  const projectRoot = await pgProjects.mkProjectRoot('runner-tasks-')
  // Plain postgres (durable: false): the test drives the store directly, not
  // through the pg_durable engine.
  await initWaypointProject(projectRoot, { quest: 'runner', postgres: { durable: false }, runtime: { recipe: 'null' } })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'runner' })
  await startQuestRoute(projectRoot, { quest: 'runner', now: new Date('2026-05-07T12:00:00.000Z') })
  return projectRoot
}

describe('Waypoint postgres task store', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('materializes task records from the started Quest scaffold', async () => {
    const projectRoot = await startedProject()

    const tasks = await listWaypointTasks(projectRoot)

    expect(tasks).toHaveLength(12)
    expect(tasks[0]).toMatchObject({
      id: 'task-001',
      route_id: 'route-001',
      plan_ref: 'initialize-context',
      status: 'open',
      kind: 'checkpoint',
    })
    expect(tasks.map((task) => task.plan_ref)).toContain('discuss-objective')
    expect(tasks.find((task) => task.plan_ref === 'discuss-objective')).toMatchObject({
      kind: 'discussion',
      metadata: {
        runner: {
          discussion: {
            enabled: true,
            mode: 'agent_chat',
            conversation_id: 'task:3:discussion:scaffold-discussion',
            agent: 'scaffold-discussion',
            status: 'active',
          },
        },
      },
    })
    // The scaffold-discussion dispatches no recipe since the coding suite was dropped
    // (D6, 2026-08-24): plan-research is a checkpoint like the rest. What this
    // test still pins is that the three KINDS materialize distinctly —
    // checkpoint, discussion, gate.
    expect(tasks.find((task) => task.plan_ref === 'plan-research')).toMatchObject({
      kind: 'checkpoint',
    })
    expect(tasks.some((task) => task.kind === 'recipe')).toBe(false)
    expect(tasks.find((task) => task.plan_ref === 'plan-approval-gate')).toMatchObject({ kind: 'gate' })

    // Single-task reads come back from the same persisted state.
    expect(await getWaypointTask(projectRoot, 'task-001')).toMatchObject({
      id: 'task-001',
      route_id: 'route-001',
      plan_ref: 'initialize-context',
      status: 'open',
      created_at: '2026-05-07T12:00:00.000Z',
      updated_at: '2026-05-07T12:00:00.000Z',
    })
    expect(await getWaypointTask(projectRoot, 'task-999')).toBeNull()
  })

  it('updates task records and persists the patch', async () => {
    const projectRoot = await startedProject()

    const updated = await updateWaypointTask(projectRoot, 'task-001', {
      status: 'done',
      updated_at: '2026-05-07T12:30:00.000Z',
    })

    expect(updated).toMatchObject({ id: 'task-001', status: 'done', updated_at: '2026-05-07T12:30:00.000Z' })
    expect(await getWaypointTask(projectRoot, 'task-001')).toMatchObject({
      status: 'done',
      updated_at: '2026-05-07T12:30:00.000Z',
    })
    // Other tasks are untouched.
    expect(await getWaypointTask(projectRoot, 'task-002')).toMatchObject({ status: 'open' })
  })
})
