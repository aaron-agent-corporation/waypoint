import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  WaypointBeadsCliIssueClient,
  type WaypointBeadsIssueCommentReader,
  type WaypointBeadsIssueCommentSnapshot,
  type WaypointBeadsIssueMutationClient,
  type WaypointBeadsIssueSnapshotReader,
} from '../beads/cli-client.ts'
import { readWaypointProjectConfig, type WaypointRouteBackendMode } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { getWaypointTask } from '../tasks/store.ts'
import { getWaypointRuntimeTask } from '../routes/read-model.ts'

import type {
  AppendTaskDiscussionMessageInput,
  TaskDiscussionMessagePage,
  WaypointDiscussionAuthor,
  WaypointTaskDiscussionMessage,
} from './types.ts'

export interface WaypointTaskDiscussionRuntimeOptions {
  readonly beadsReader?: WaypointBeadsIssueSnapshotReader
  readonly beadsCommentReader?: WaypointBeadsIssueCommentReader
  readonly beadsMutator?: WaypointBeadsIssueMutationClient
}

const BEADS_DISCUSSION_HEADER = 'Waypoint discussion message'

export async function appendTaskDiscussionMessage(
  projectRoot: string,
  taskId: string,
  input: AppendTaskDiscussionMessageInput,
  options: WaypointTaskDiscussionRuntimeOptions = {},
): Promise<WaypointTaskDiscussionMessage> {
  if ((await routeBackend(projectRoot)) === 'beads') return appendBeadsTaskDiscussionMessage(projectRoot, taskId, input, options)

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
      waypoint: {
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
  options: WaypointTaskDiscussionRuntimeOptions = {},
): Promise<TaskDiscussionMessagePage> {
  if ((await routeBackend(projectRoot)) === 'beads') return readBeadsTaskDiscussionMessages(projectRoot, taskId, options)

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

async function appendBeadsTaskDiscussionMessage(
  projectRoot: string,
  taskId: string,
  input: AppendTaskDiscussionMessageInput,
  options: WaypointTaskDiscussionRuntimeOptions,
): Promise<WaypointTaskDiscussionMessage> {
  const task = await getWaypointRuntimeTask(projectRoot, taskId, { beadsReader: options.beadsReader })
  if (!task) throw new Error(`Task not found: ${taskId}`)
  if (task.kind !== 'discussion') throw new Error(`Task is not discussion-enabled: ${taskId}`)

  const existing = await readBeadsTaskDiscussionMessages(projectRoot, taskId, options)
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
      waypoint: {
        authored_by: author,
        agent,
        conversation_id: taskDiscussionConversationId(task.metadata),
        auto_response: autoResponseMetadata(author, agent),
        backend: 'beads',
      },
    },
  }

  const mutator = options.beadsMutator ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  await mutator.addIssueComment({ id: task.id, text: encodeBeadsDiscussionComment(message) })
  return message
}

async function readBeadsTaskDiscussionMessages(
  projectRoot: string,
  taskId: string,
  options: WaypointTaskDiscussionRuntimeOptions,
): Promise<TaskDiscussionMessagePage> {
  const task = await getWaypointRuntimeTask(projectRoot, taskId, { beadsReader: options.beadsReader })
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const reader = options.beadsCommentReader ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  const messages = (await reader.listIssueComments(taskId))
    .map((comment, index) => messageFromBeadsComment(comment, task, index))
    .filter(isPresent)
  return { task_id: taskId, total: messages.length, items: messages }
}

function encodeBeadsDiscussionComment(message: WaypointTaskDiscussionMessage): string {
  return `${BEADS_DISCUSSION_HEADER}\nauthor: ${message.author}\ncreated_at: ${message.created_at}\n\n${message.content}`
}

function messageFromBeadsComment(
  comment: WaypointBeadsIssueCommentSnapshot,
  task: { readonly id: string; readonly route_id: string; readonly metadata?: unknown },
  index: number,
): WaypointTaskDiscussionMessage | null {
  const parsed = parseBeadsDiscussionComment(comment.text)
  if (!parsed) return null
  const agent = taskDiscussionAgent(task.metadata)
  return {
    id: comment.id || `message-${String(index + 1).padStart(3, '0')}`,
    task_id: task.id,
    route_id: task.route_id,
    author: parsed.author,
    content: parsed.content,
    created_at: comment.created_at ?? parsed.createdAt ?? '',
    metadata: {
      waypoint: {
        authored_by: parsed.author,
        agent,
        conversation_id: taskDiscussionConversationId(task.metadata),
        auto_response: autoResponseMetadata(parsed.author, agent),
        backend: 'beads',
      },
    },
  }
}

function parseBeadsDiscussionComment(
  text: string,
): { readonly author: WaypointDiscussionAuthor; readonly createdAt?: string; readonly content: string } | null {
  if (!text.startsWith(BEADS_DISCUSSION_HEADER)) return null
  const separator = text.indexOf('\n\n')
  if (separator === -1) return null
  const header = text.slice(0, separator).split('\n')
  const content = text.slice(separator + 2)
  const authorLine = header.find((line) => line.startsWith('author:'))
  const createdAtLine = header.find((line) => line.startsWith('created_at:'))
  const rawAuthor = authorLine?.slice('author:'.length).trim()
  const author: WaypointDiscussionAuthor = rawAuthor === 'agent' ? 'agent' : 'user'
  const createdAt = createdAtLine?.slice('created_at:'.length).trim()
  return {
    author,
    ...(createdAt ? { createdAt } : {}),
    content,
  }
}

async function routeBackend(projectRoot: string): Promise<WaypointRouteBackendMode> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return config.backend.route
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return 'folder'
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
  const waypoint = isRecord(outer.waypoint) ? outer.waypoint : {}
  return isRecord(waypoint.discussion) ? waypoint.discussion : {}
}

function tasksDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'tasks')
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

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
