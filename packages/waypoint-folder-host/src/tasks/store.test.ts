import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { startQuestRoute } from '../routes/start'
import { listWaypointTasks } from './store'

async function startedProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-tasks-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint' })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  await startQuestRoute(projectRoot, { quest: 'waypoint', now: new Date('2026-05-07T12:00:00.000Z') })
  return projectRoot
}

describe('Waypoint folder task store', () => {
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
        waypoint: {
          discussion: {
            enabled: true,
            mode: 'agent_chat',
            conversation_id: 'task:3:discussion:waypoint-doc-writer',
            agent: 'waypoint-doc-writer',
            status: 'active',
          },
        },
      },
    })
    expect(tasks.find((task) => task.plan_ref === 'plan-research')).toMatchObject({
      kind: 'recipe',
      metadata: { waypoint: { recipe: { slug: 'waypoint-phase-researcher' } } },
    })
    expect(tasks.find((task) => task.plan_ref === 'plan-approval-gate')).toMatchObject({ kind: 'gate' })

    const yaml = yamlParse(await readFile(join(projectRoot, '.waypoint/tasks/tasks.yaml'), 'utf8')) as { tasks: unknown[] }
    expect(yaml.tasks).toHaveLength(12)
  })
})
