import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appendTaskDiscussionMessage, readTaskDiscussionMessages } from './store'
import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { startQuestRoute } from '../routes/start'
import { PostgresTestProjects } from '../testing/postgres'

// Discussion JSONL stays disk-local, but starting a route (and reading its
// task rows) goes through the postgres store (P5) — needs the test instance.
const projects = new PostgresTestProjects()

beforeAll(() => {
  projects.setEnv()
})

afterAll(async () => {
  await projects.cleanup()
})

async function startedProject(): Promise<string> {
  const projectRoot = await projects.mkProjectRoot('runner-discussion-')
  await initWaypointProject(projectRoot, { quest: 'runner', runtime: { recipe: 'null' } })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'runner' })
  await startQuestRoute(projectRoot, { quest: 'runner' })
  return projectRoot
}

describe('Waypoint folder discussion store', () => {
  it('appends task-scoped discussion messages to JSONL', async () => {
    const projectRoot = await startedProject()

    const message = await appendTaskDiscussionMessage(projectRoot, 'task-003', {
      author: 'user',
      content: 'What are the acceptance criteria?',
      now: new Date('2026-05-07T12:30:00.000Z'),
    })

    expect(message).toMatchObject({
      id: 'message-001',
      task_id: 'task-003',
      author: 'user',
      content: 'What are the acceptance criteria?',
      metadata: {
        runner: {
          authored_by: 'user',
          auto_response: {
            requested: false,
            agent: 'scaffold-discussion',
            reason: 'global_disabled',
          },
        },
      },
    })

    const page = await readTaskDiscussionMessages(projectRoot, 'task-003')
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ id: 'message-001', content: 'What are the acceptance criteria?' })

    const jsonl = await readFile(join(projectRoot, '.waypoint/tasks/task-003-discussion.jsonl'), 'utf8')
    expect(jsonl).toContain('What are the acceptance criteria?')
  })

  it('records agent-authored messages as loop-prevented', async () => {
    const projectRoot = await startedProject()

    const message = await appendTaskDiscussionMessage(projectRoot, 'task-003', {
      author: 'agent',
      content: 'I will not trigger another agent response.',
    })

    expect(message.metadata).toMatchObject({
      runner: {
        authored_by: 'agent',
        agent: 'scaffold-discussion',
        auto_response: {
          requested: false,
          reason: 'agent_authored',
        },
      },
    })
  })
})
