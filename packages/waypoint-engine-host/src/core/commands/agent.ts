import { EngineError, ok } from '../../envelope.ts'
import type { BrainResult } from '../../brain/brain-adapter.ts'
import type { AgentSession } from '../../brain/agent-session.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

/**
 * Default scoped tool allowlist (MAR Contract Lock 5). Excludes the entire
 * `agent.*` namespace (no agent-spawns-agent recursion / fork-bomb), plus
 * `author.approveProposal` and `workspace.open`. This set becomes the minted
 * scoped token's allow-set, so it is host-enforced, not advisory.
 */
export const AGENT_TOOL_GRANT: readonly string[] = Object.freeze([
  'author.recipe',
  'author.quest',
  'author.designSpec',
  'author.handoff',
  'author.promote',
  'run.adhoc',
  'catalog.quests',
  'catalog.recipes',
  'routes.list',
  'route.get',
  'route.events',
  'tasks.list',
  'meta.commands',
  'meta.version',
])

const FORBIDDEN_TOOLS = Object.freeze(['author.approveProposal', 'workspace.open'])

function resolveTools(requested: readonly string[] | undefined): readonly string[] {
  if (!requested) return AGENT_TOOL_GRANT
  for (const tool of requested) {
    if (tool.startsWith('agent.') || FORBIDDEN_TOOLS.includes(tool) || !AGENT_TOOL_GRANT.includes(tool)) {
      throw new EngineError(`Tool not in agent grant: ${tool}`, { code: 'VALIDATION', field: 'tools' })
    }
  }
  return requested
}

const SYSTEM_PROMPT =
  'You are the Waypoint authoring agent. Turn the user intent into a Waypoint recipe or quest ' +
  'using only the granted tools. You may run an authored draft ad-hoc and propose promotion. ' +
  'You may NOT approve proposals, open workspaces, or spawn other agents.'

function resultData(result: BrainResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    ...(result.proposalId !== undefined ? { proposalId: result.proposalId } : {}),
    ...(result.adhocRouteId !== undefined ? { adhocRouteId: result.adhocRouteId } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  }
}

export function registerAgentCommands(bus: CommandBus, ctx: EngineContext): void {
  // Mint a session + its scoped token + lease, wired to release/revoke on terminal.
  function startSession(intent: string, tools: readonly string[]): AgentSession {
    const { root } = ctx.session.requireActive()
    const id = ctx.nextAgentId()
    const scopedToken = ctx.tokens.mintScoped(id, new Set(tools))
    const adapter = ctx.brainFactory.forSession({ hostUrl: ctx.getHostUrl(), hostToken: scopedToken })
    const lease = ctx.session.acquireLease()
    return ctx.agents.create({
      id,
      intent,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      adapter,
      hub: ctx.hub,
      root,
      onTerminal: () => {
        lease()
        ctx.tokens.revoke(scopedToken)
      },
    })
  }

  function parseIntent(payload: unknown): { intent: string; tools: readonly string[] } {
    const input = (payload ?? {}) as { intent?: string; tools?: readonly string[] }
    if (!input.intent || typeof input.intent !== 'string') {
      throw new EngineError('agent requires an intent', { code: 'VALIDATION', field: 'intent' })
    }
    return { intent: input.intent, tools: resolveTools(input.tools) }
  }

  // --- 5a: lifecycle / mutation ------------------------------------------------

  // Async: returns immediately; the run streams on agent:<sessionId> and is
  // observable via agent.watch / cancellable via agent.cancel (MAR Lock 6).
  bus.register('agent.author', async (payload) => {
    const { intent, tools } = parseIntent(payload)
    const session = startSession(intent, tools)
    void session.run().catch(() => undefined)
    return ok('agent.author', { sessionId: session.id, status: 'running' })
  })

  // Convenience: same as author but awaits the terminal result (one-call path).
  bus.register('agent.run', async (payload) => {
    const { intent, tools } = parseIntent(payload)
    const session = startSession(intent, tools)
    const result = await session.run()
    return ok('agent.run', { sessionId: session.id, ...resultData(result) })
  })

  bus.register('agent.cancel', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { sessionId?: string }
    if (!input.sessionId) throw new EngineError('agent.cancel requires a sessionId', { code: 'VALIDATION', field: 'sessionId' })
    return ok('agent.cancel', { sessionId: input.sessionId, cancelled: ctx.agents.cancel(input.sessionId) })
  })

  // --- 5b: observability (read-only) ------------------------------------------

  bus.register('agent.list', async () => {
    ctx.session.requireActive()
    return ok('agent.list', { sessions: ctx.agents.list() })
  })

  bus.register('agent.transcript', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { sessionId?: string }
    if (!input.sessionId) throw new EngineError('agent.transcript requires a sessionId', { code: 'VALIDATION', field: 'sessionId' })
    const session = ctx.agents.get(input.sessionId)
    if (!session) throw new EngineError(`Agent session not found: ${input.sessionId}`, { code: 'NOT_FOUND', field: 'sessionId' })
    return ok('agent.transcript', { sessionId: input.sessionId, events: session.transcript() })
  })

  // Replay cursor = transcript-relative idx (Lock 4); live tail is the WS
  // `agent:<sessionId>` subscription.
  bus.register('agent.watch', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { sessionId?: string; sinceSeq?: number }
    if (!input.sessionId) throw new EngineError('agent.watch requires a sessionId', { code: 'VALIDATION', field: 'sessionId' })
    const session = ctx.agents.get(input.sessionId)
    if (!session) throw new EngineError(`Agent session not found: ${input.sessionId}`, { code: 'NOT_FOUND', field: 'sessionId' })
    const since = typeof input.sinceSeq === 'number' ? input.sinceSeq : -1
    const events = session
      .transcript()
      .map((event, idx) => ({ idx, ...event }))
      .filter((event) => event.idx > since)
    return ok('agent.watch', { sessionId: input.sessionId, status: session.status(), events })
  })
}
