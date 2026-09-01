import { appendTaskDiscussionMessage, readTaskDiscussionMessages } from '@waypoint-engine/folder-host'
import { getWaypointRuntimeTask } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runDiscussCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const taskId = valueAfter(args, '--task-id')
  if (!taskId) {
    io.stderr('Missing required --task-id')
    return 1
  }

  const message = valueAfter(args, '--message')
  const author = valueAfter(args, '--author') === 'agent' ? 'agent' : 'user'
  if (message) {
    await appendTaskDiscussionMessage(projectRoot, taskId, { author, content: message })
  }

  const task = await getWaypointRuntimeTask(projectRoot, taskId)
  if (!task) {
    io.stderr(`Task not found: ${taskId}`)
    return 1
  }
  const discussion = discussionMetadata(task.metadata)
  const page = await readTaskDiscussionMessages(projectRoot, taskId)

  io.stdout(`Discussion ${taskId}`)
  io.stdout(`conversation: ${typeof discussion.conversation_id === 'string' ? discussion.conversation_id : 'none'}`)
  io.stdout(`total: ${page.total}`)
  for (const item of page.items) {
    const autoResponse = autoResponseMetadata(item.metadata)
    io.stdout(`- ${item.id} ${item.author}`)
    io.stdout(`  ${item.content}`)
    io.stdout(`  auto_response: requested=${autoResponse.requested} reason=${autoResponse.reason} agent=${autoResponse.agent}`)
  }
  return 0
}

function valueAfter(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}

function discussionMetadata(metadata: unknown): Record<string, unknown> {
  const outer = isRecord(metadata) ? metadata : {}
  const runner = isRecord(outer.runner) ? outer.runner : {}
  return isRecord(runner.discussion) ? runner.discussion : {}
}

function autoResponseMetadata(metadata: unknown): { requested: boolean; reason: string; agent: string } {
  const outer = isRecord(metadata) ? metadata : {}
  const runner = isRecord(outer.runner) ? outer.runner : {}
  const autoResponse = isRecord(runner.auto_response) ? runner.auto_response : {}
  return {
    requested: autoResponse.requested === true,
    reason: typeof autoResponse.reason === 'string' ? autoResponse.reason : 'unknown',
    agent: typeof autoResponse.agent === 'string' ? autoResponse.agent : 'agent',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
