import {
  buildWaypointTaskDiscussionConversationId,
  isStrictWaypointTaskDiscussionConversationId,
} from './conversation'

export type WaypointTaskDiscussionStatus = 'pending' | 'active' | 'summarized' | 'closed'

export type WaypointTaskDiscussionAutoResponseMetadata = {
  enabled: boolean
}

export type WaypointDiscussionAutoResponseSkipReason = 'metadata_disabled' | 'global_disabled' | 'missing_agent'

export type WaypointDiscussionAutoResponseDecision =
  | { requested: true; agent: string }
  | { requested: false; agent?: string; reason: WaypointDiscussionAutoResponseSkipReason }

export type WaypointTaskDiscussionMetadata = {
  enabled: boolean
  mode?: 'agent_chat'
  conversation_id?: string
  agent?: string
  prompt?: string
  started_at?: number
  status?: WaypointTaskDiscussionStatus
  summary_comment_id?: number | null
  auto_response?: WaypointTaskDiscussionAutoResponseMetadata
}

export type WaypointTaskDiscussionMessageTask = {
  id: number
  title: string
  project_id: number | null
  metadata: unknown
}

export type WaypointTaskDiscussionMessageMetadata = {
  kind: 'waypoint_task_discussion'
  task_id: number
  task_title: string
  project_id: number | null
  workflow_instance_id: number | null
  workflow_node_instance_id: number | null
  waypoint: true
}

export function parseWaypointJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseStatus(value: unknown): WaypointTaskDiscussionStatus | undefined {
  return ['pending', 'active', 'summarized', 'closed'].includes(String(value))
    ? (value as WaypointTaskDiscussionStatus)
    : undefined
}

export function parseWaypointTaskDiscussionMetadata(raw: unknown): WaypointTaskDiscussionMetadata {
  const metadata = parseWaypointJsonObject(raw)
  const waypoint = parseWaypointJsonObject(metadata.waypoint)
  const discussion = parseWaypointJsonObject(waypoint.discussion)
  if (Object.keys(discussion).length === 0) return { enabled: false }
  const autoResponse = parseWaypointJsonObject(discussion.auto_response)
  return {
    enabled: discussion.enabled === true,
    mode: discussion.mode === 'agent_chat' ? 'agent_chat' : undefined,
    conversation_id: typeof discussion.conversation_id === 'string' ? discussion.conversation_id : undefined,
    agent: typeof discussion.agent === 'string' ? discussion.agent : undefined,
    prompt: typeof discussion.prompt === 'string' ? discussion.prompt : undefined,
    started_at: typeof discussion.started_at === 'number' ? discussion.started_at : undefined,
    status: parseStatus(discussion.status),
    summary_comment_id: typeof discussion.summary_comment_id === 'number' ? discussion.summary_comment_id : null,
    auto_response: autoResponse.enabled === true ? { enabled: true } : undefined,
  }
}

export function isWaypointTaskDiscussionEnabled(raw: unknown): boolean {
  return parseWaypointTaskDiscussionMetadata(raw).enabled
}

export function mergeWaypointTaskDiscussionMetadata(
  raw: unknown,
  discussion: Omit<WaypointTaskDiscussionMetadata, 'mode'> & { mode?: 'agent_chat' },
): Record<string, unknown> {
  const metadata = parseWaypointJsonObject(raw)
  const waypoint = parseWaypointJsonObject(metadata.waypoint)
  const existingDiscussion = parseWaypointJsonObject(waypoint.discussion)
  return {
    ...metadata,
    waypoint: {
      ...waypoint,
      discussion: {
        ...existingDiscussion,
        mode: 'agent_chat',
        ...discussion,
      },
    },
  }
}

export function parseWaypointWorkflowMetadataNumber(raw: unknown, key: string): number | null {
  const metadata = parseWaypointJsonObject(raw)
  const workflow = parseWaypointJsonObject(metadata.workflow)
  const value = workflow[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveWaypointTaskDiscussionStatus(
  status: WaypointTaskDiscussionStatus | null | undefined,
): WaypointTaskDiscussionStatus {
  return status === 'closed' || status === 'summarized' ? status : 'active'
}

export function resolveWaypointTaskDiscussionAgent(input: {
  requestedAgent?: string | null
  existingAgent?: string | null
  assignedTo?: string | null
}): string {
  return input.requestedAgent?.trim() || input.existingAgent?.trim() || input.assignedTo?.trim() || 'agent'
}

export function normalizeWaypointTaskDiscussionListLimit(limit: number | null | undefined): number {
  return Math.max(1, Math.min(limit ?? 100, 200))
}

export function normalizeWaypointTaskDiscussionMessageContent(content: string): string {
  return content.trim()
}

/**
 * Parse an environment variable value into a boolean flag for discussion
 * auto-response gating. Recognized truthy values (case + whitespace tolerant):
 *   '1', 'true', 'yes', 'on'
 * Anything else (including undefined/null/empty/unknown tokens) → false.
 */
export function parseWaypointDiscussionAutoResponseEnvFlag(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function resolveWaypointDiscussionAutoResponse(input: {
  metadataOptIn: boolean
  globalOptIn: boolean
  agent?: string | null
}): WaypointDiscussionAutoResponseDecision {
  const normalizedAgent = typeof input.agent === 'string' ? input.agent.trim() : ''
  if (!input.metadataOptIn) {
    return {
      requested: false,
      ...(normalizedAgent ? { agent: normalizedAgent } : {}),
      reason: 'metadata_disabled',
    }
  }

  if (!input.globalOptIn) {
    return {
      requested: false,
      ...(normalizedAgent ? { agent: normalizedAgent } : {}),
      reason: 'global_disabled',
    }
  }

  if (!normalizedAgent) {
    return {
      requested: false,
      reason: 'missing_agent',
    }
  }

  return {
    requested: true,
    agent: normalizedAgent,
  }
}

export function buildWaypointTaskDiscussionStartMetadata(input: {
  taskId: number
  now: number
  agent: string
  existing: WaypointTaskDiscussionMetadata
}): WaypointTaskDiscussionMetadata {
  const conversationId = isStrictWaypointTaskDiscussionConversationId(input.existing.conversation_id, input.taskId)
    ? input.existing.conversation_id
    : buildWaypointTaskDiscussionConversationId(input.taskId, input.agent)

  return {
    ...input.existing,
    enabled: true,
    mode: 'agent_chat',
    conversation_id: conversationId,
    agent: input.agent,
    started_at: input.existing.started_at ?? input.now,
    status: resolveWaypointTaskDiscussionStatus(input.existing.status),
    summary_comment_id: input.existing.summary_comment_id ?? null,
  }
}

export function buildWaypointTaskDiscussionMessageMetadata(
  task: WaypointTaskDiscussionMessageTask,
): WaypointTaskDiscussionMessageMetadata {
  return {
    kind: 'waypoint_task_discussion',
    task_id: task.id,
    task_title: task.title,
    project_id: task.project_id,
    workflow_instance_id: parseWaypointWorkflowMetadataNumber(task.metadata, 'workflow_instance_id'),
    workflow_node_instance_id: parseWaypointWorkflowMetadataNumber(task.metadata, 'node_instance_id'),
    waypoint: true,
  }
}
