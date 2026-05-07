import type { HermesProjectRecord } from './project-registry.ts'
import { runSafeWaypointCommand, type WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

export interface HermesDiscussionAgentInput {
  readonly recipeSlug: string
  readonly taskId: string
  readonly conversationId: string
  readonly userMessage: string
}

export interface HermesDiscussionAgentReply {
  readonly content: string
  readonly summary?: string
}

export interface HermesDiscussionAgentRuntime {
  reply(input: HermesDiscussionAgentInput): Promise<HermesDiscussionAgentReply>
}

export interface RunHermesDiscussionLoopInput {
  readonly taskId: string
  readonly userMessage: string
  readonly requestAgent: boolean
  readonly agentRuntime?: HermesDiscussionAgentRuntime
  readonly executor?: WaypointCommandExecutor
}

export interface HermesDiscussionLoopResult {
  readonly taskId: string
  readonly conversationId: string
  readonly agent: string
  readonly userMessageId: string
  readonly agentMessageId: string | null
  readonly loopPrevention: {
    readonly requested: false
    readonly reason: string
  } | null
  readonly userCommandStdout: string
  readonly agentCommandStdout: string | null
}

const defaultRuntime: HermesDiscussionAgentRuntime = {
  async reply(input) {
    return {
      content: `Hermes reference discussion adapter routed ${input.taskId} to ${input.recipeSlug}.`,
      summary: 'reference discussion reply',
    }
  },
}

export async function runHermesDiscussionLoop(
  project: HermesProjectRecord,
  input: RunHermesDiscussionLoopInput,
): Promise<HermesDiscussionLoopResult> {
  const userResult = await runSafeWaypointCommand(
    project,
    ['discuss', '--task-id', input.taskId, '--message', input.userMessage],
    { executor: input.executor },
  )
  if (!userResult.ok) throw new Error(`Waypoint discuss user message failed: ${userResult.stderr || userResult.stdout}`)

  const userSnapshot = parseDiscussionCommandOutput(userResult.stdout)
  const userMessage = lastMessageByAuthor(userSnapshot.messages, 'user')
  if (!userMessage) throw new Error(`Waypoint discuss did not return a user message for ${input.taskId}`)

  if (!input.requestAgent) {
    return {
      taskId: input.taskId,
      conversationId: userSnapshot.conversationId,
      agent: userSnapshot.agent,
      userMessageId: userMessage.id,
      agentMessageId: null,
      loopPrevention: null,
      userCommandStdout: userResult.stdout,
      agentCommandStdout: null,
    }
  }

  const runtime = input.agentRuntime ?? defaultRuntime
  const reply = await runtime.reply({
    recipeSlug: userSnapshot.agent,
    taskId: input.taskId,
    conversationId: userSnapshot.conversationId,
    userMessage: input.userMessage,
  })
  if (reply.content.trim() === '') throw new Error('Hermes discussion agent returned an empty reply')

  const agentResult = await runSafeWaypointCommand(
    project,
    ['discuss', '--task-id', input.taskId, '--author', 'agent', '--message', reply.content],
    { executor: input.executor },
  )
  if (!agentResult.ok) throw new Error(`Waypoint discuss agent message failed: ${agentResult.stderr || agentResult.stdout}`)

  const agentSnapshot = parseDiscussionCommandOutput(agentResult.stdout)
  const agentMessage = lastMessageByAuthor(agentSnapshot.messages, 'agent')
  if (!agentMessage) throw new Error(`Waypoint discuss did not return an agent message for ${input.taskId}`)

  return {
    taskId: input.taskId,
    conversationId: agentSnapshot.conversationId,
    agent: agentSnapshot.agent,
    userMessageId: userMessage.id,
    agentMessageId: agentMessage.id,
    loopPrevention: {
      requested: false,
      reason: agentMessage.autoResponseReason,
    },
    userCommandStdout: userResult.stdout,
    agentCommandStdout: agentResult.stdout,
  }
}

interface DiscussionOutputSnapshot {
  readonly conversationId: string
  readonly agent: string
  readonly messages: readonly DiscussionOutputMessage[]
}

interface DiscussionOutputMessage {
  readonly id: string
  readonly author: 'user' | 'agent'
  readonly autoResponseReason: string
}

function parseDiscussionCommandOutput(output: string): DiscussionOutputSnapshot {
  const lines = output.split('\n')
  const conversationLine = lines.find((line) => line.startsWith('conversation: '))
  if (!conversationLine) throw new Error('Waypoint discussion output missing conversation line')
  const messages: DiscussionOutputMessage[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- (message-\d+) (user|agent)$/.exec(lines[index]?.trim() ?? '')
    if (!match) continue
    const autoResponseLine = lines.slice(index + 1).find((line) => line.trim().startsWith('auto_response: '))?.trim() ?? ''
    const reason = /reason=([^\s]+)/.exec(autoResponseLine)?.[1] ?? 'unknown'
    messages.push({ id: match[1], author: match[2] as 'user' | 'agent', autoResponseReason: reason })
  }
  const autoResponseLines = lines.filter((line) => line.includes('auto_response: '))
  const lastAutoResponseLine = autoResponseLines[autoResponseLines.length - 1] ?? ''
  const agent = /agent=([^\s]+)/.exec(lastAutoResponseLine)?.[1] ?? 'agent'
  return {
    conversationId: conversationLine.replace('conversation: ', '').trim(),
    agent,
    messages,
  }
}

function lastMessageByAuthor(
  messages: readonly DiscussionOutputMessage[],
  author: 'user' | 'agent',
): DiscussionOutputMessage | null {
  return [...messages].reverse().find((message) => message.author === author) ?? null
}
