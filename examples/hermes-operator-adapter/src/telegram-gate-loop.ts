import type { HermesProjectRecord } from './project-registry.ts'
import { runSafeWaypointCommand, type WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

export type HermesTelegramGateAction = 'approve' | 'reject' | 'revise' | 'show_tasks' | 'show_events'

export interface TelegramGatePromptInput {
  readonly routeId: string
  readonly node: string
  readonly summary?: string
}

export interface RunHermesTelegramGateLoopInput {
  readonly routeId: string
  readonly node: string
  readonly reply: string
  readonly nextNode?: string
  readonly executor?: WaypointCommandExecutor
}

export interface HermesTelegramGateLoopResult {
  readonly action: HermesTelegramGateAction
  readonly command: string
  readonly message: string
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export function buildTelegramGatePrompt(input: TelegramGatePromptInput): string {
  const summary = input.summary?.trim() ? input.summary.trim() : 'No summary available.'
  return `${input.routeId} is blocked at ${input.node}.\nSummary: ${summary}\nReply: approve, reject, revise, show tasks, or show events.`
}

export async function runHermesTelegramGateLoop(
  project: HermesProjectRecord,
  input: RunHermesTelegramGateLoopInput,
): Promise<HermesTelegramGateLoopResult> {
  const decision = parseTelegramGateReply(input.reply)
  const waypointArgs = waypointArgsForDecision(input, decision)
  const result = await runSafeWaypointCommand(project, waypointArgs, { executor: input.executor })
  if (!result.ok) throw new Error(`Waypoint gate loop command failed: ${result.stderr || result.stdout}`)
  return {
    action: decision.action,
    command: result.command,
    message: summarizeGateLoopResult(decision.action, result.stdout),
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  }
}

interface ParsedTelegramGateReply {
  readonly action: HermesTelegramGateAction
  readonly note?: string
}

function parseTelegramGateReply(reply: string): ParsedTelegramGateReply {
  const normalized = reply.trim().replace(/\s+/g, ' ')
  const lower = normalized.toLowerCase()
  if (lower === 'approve' || lower.startsWith('approve ')) return { action: 'approve' }
  if (lower === 'show tasks' || lower === 'tasks') return { action: 'show_tasks' }
  if (lower === 'show events' || lower === 'events') return { action: 'show_events' }
  if (lower === 'reject') return { action: 'reject' }
  if (lower.startsWith('reject ')) return { action: 'reject', note: normalized.slice('reject '.length).trim() }
  if (lower === 'revise') return { action: 'revise', note: 'revise requested' }
  if (lower.startsWith('revise:')) return { action: 'revise', note: normalized }
  if (lower.startsWith('revise ')) return { action: 'revise', note: `revise: ${normalized.slice('revise '.length).trim()}` }
  throw new Error(`Unsupported Telegram gate reply: ${reply}`)
}

function waypointArgsForDecision(input: RunHermesTelegramGateLoopInput, decision: ParsedTelegramGateReply): readonly string[] {
  if (decision.action === 'show_tasks') return ['tasks', '--route-id', input.routeId]
  if (decision.action === 'show_events') return ['route-events', '--route-id', input.routeId, '--limit', '20']

  const base = ['gate', '--route-id', input.routeId, '--node', input.node]
  if (decision.action === 'approve') {
    return input.nextNode ? [...base, '--approve', '--next-node', input.nextNode] : [...base, '--approve']
  }

  return decision.note ? [...base, '--reject', '--note', decision.note] : [...base, '--reject']
}

function summarizeGateLoopResult(action: HermesTelegramGateAction, stdout: string): string {
  const trimmed = stdout.trim()
  if (action === 'show_tasks' || action === 'show_events') return trimmed
  const statusLine = trimmed.split('\n').find((line) => line.startsWith('status: ')) ?? 'status: unknown'
  return `${trimmed}\nHermes Telegram gate loop applied decision; updated route ${statusLine}.`
}
