import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { appendTaskDiscussionMessage, readTaskDiscussionMessages } from './store'
import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { startQuestRoute } from '../routes/start'

async function startedProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-discussion-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint' })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  await startQuestRoute(projectRoot, { quest: 'waypoint' })
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
        waypoint: {
          authored_by: 'user',
          auto_response: {
            requested: false,
            agent: 'waypoint-doc-writer',
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
      waypoint: {
        authored_by: 'agent',
        agent: 'waypoint-doc-writer',
        auto_response: {
          requested: false,
          reason: 'agent_authored',
        },
      },
    })
  })
})
