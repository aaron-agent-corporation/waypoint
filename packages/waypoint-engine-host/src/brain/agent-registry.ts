import { AgentSession, type AgentSessionDeps, type AgentStatus } from './agent-session.ts'

export interface AgentSummary {
  readonly id: string
  readonly intent: string
  readonly status: AgentStatus
  readonly startedAt: string
}

/** In-memory registry of live agent sessions — kill-switch + observability lookup. */
export class AgentRegistry {
  private readonly sessions = new Map<string, AgentSession>()

  create(deps: AgentSessionDeps): AgentSession {
    const session = new AgentSession(deps)
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  list(): readonly AgentSummary[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      intent: s.intent,
      status: s.status(),
      startedAt: s.startedAt,
    }))
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.cancel()
    return true
  }

  /** Cancel every live session — used on workspace switch / host stop (decision 16). */
  cancelAll(): void {
    for (const session of this.sessions.values()) session.cancel()
  }
}
