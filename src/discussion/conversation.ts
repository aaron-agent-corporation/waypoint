export function slugifyWaypointAgent(value: string | null | undefined): string {
  return (value || 'agent')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

export function buildWaypointTaskDiscussionConversationId(
  taskId: number,
  agent: string | null | undefined,
): string {
  return `task:${taskId}:discussion:${slugifyWaypointAgent(agent)}`
}

export function isStrictWaypointTaskDiscussionConversationId(value: unknown, taskId: number): value is string {
  if (typeof value !== 'string') return false
  return value.startsWith(`task:${taskId}:discussion:`) && value.length > `task:${taskId}:discussion:`.length
}
