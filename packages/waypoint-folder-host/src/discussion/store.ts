import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointTask } from '../tasks/store.ts'

import type {
  AppendTaskDiscussionMessageInput,
  TaskDiscussionMessagePage,
  WaypointDiscussionAuthor,
  WaypointTaskDiscussionMessage,
} from './types.ts'

export async function appendTaskDiscussionMessage(
  projectRoot: string,
  taskId: string,
  input: AppendTaskDiscussionMessageInput,
): Promise<WaypointTaskDiscussionMessage> {
  const task = await getWaypointTask(projectRoot, taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  if (task.kind !== 'discussion') throw new Error(`Task is not discussion-enabled: ${taskId}`)

  const existing = await readTaskDiscussionMessages(projectRoot, taskId)
  const author: WaypointDiscussionAuthor = input.author ?? 'user'
  const agent = taskDiscussionAgent(task.metadata)
  const message: WaypointTaskDiscussionMessage = {
    id: `message-${String(existing.total + 1).padStart(3, '0')}`,
    task_id: task.id,
    route_id: task.route_id,
    author,
    content: input.content.trim(),
    created_at: timestampFor(input.now),
    metadata: {
      runner: {
        authored_by: author,
        agent,
        conversation_id: taskDiscussionConversationId(task.metadata),
        auto_response: autoResponseMetadata(author, agent),
      },
    },
  }

  const dir = tasksDirectory(projectRoot)
  await mkdir(dir, { recursive: true })
  await writeFile(discussionPath(projectRoot, taskId), `${JSON.stringify(message)}\n`, { flag: 'a', encoding: 'utf8' })
  return message
}

export async function readTaskDiscussionMessages(
  projectRoot: string,
  taskId: string,
): Promise<TaskDiscussionMessagePage> {
  try {
    const content = await readFile(discussionPath(projectRoot, taskId), 'utf8')
    const items = content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as WaypointTaskDiscussionMessage)
    return { task_id: taskId, total: items.length, items }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { task_id: taskId, total: 0, items: [] }
    throw error
  }
}

function autoResponseMetadata(author: WaypointDiscussionAuthor, agent: string): Record<string, unknown> {
  if (author === 'agent') {
    return { requested: false, agent, reason: 'agent_authored' }
  }
  return { requested: false, agent, reason: 'global_disabled' }
}

function taskDiscussionAgent(metadata: unknown): string {
  const discussion = taskDiscussionMetadata(metadata)
  return typeof discussion.agent === 'string' && discussion.agent.trim() ? discussion.agent.trim() : 'agent'
}

function taskDiscussionConversationId(metadata: unknown): string | null {
  const discussion = taskDiscussionMetadata(metadata)
  return typeof discussion.conversation_id === 'string' ? discussion.conversation_id : null
}

function taskDiscussionMetadata(metadata: unknown): Record<string, unknown> {
  const outer = isRecord(metadata) ? metadata : {}
  const runner = isRecord(outer.runner) ? outer.runner : {}
  return isRecord(runner.discussion) ? runner.discussion : {}
}

function tasksDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).runnerDir, 'tasks')
}

function discussionPath(projectRoot: string, taskId: string): string {
  return join(tasksDirectory(projectRoot), `${taskId}-discussion.jsonl`)
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
