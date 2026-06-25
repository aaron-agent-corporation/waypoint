import { create } from 'zustand'

import type {
  AgentEventRecord,
  AgentSessionSummary,
  EngineWsMessage,
  WaypointFolderRoute,
  WaypointFolderTask,
} from './engine/types'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'error'

interface UiState {
  connection: ConnectionStatus
  seq: number
  routes: WaypointFolderRoute[]
  tasks: WaypointFolderTask[]
  sessions: AgentSessionSummary[]
  transcripts: Record<string, AgentEventRecord[]>
  selectedRouteId: string | null
  selectedTaskId: string | null
  activeSessionId: string | null
  /**
   * Monotonic counter bumped whenever routes/tasks may have changed (route event
   * or resnapshot). A counter rather than a boolean so every change retriggers a
   * refetch even when one is already pending — a failed refetch isn't permanently
   * dropped, since the next event advances the epoch again.
   */
  routesEpoch: number
  /**
   * Errors are kept per-source so a healthy poll of one endpoint can't clear an
   * outage on another: `sessionsError` ← agent.list poll, `routesError` ←
   * routes/tasks refresh, `error` ← engine-pushed WS error frames.
   */
  sessionsError: string | null
  routesError: string | null
  error: string | null

  applyMessage(msg: EngineWsMessage): void
  /**
   * Advance the routes epoch to force a routes/tasks refetch. Used for recovery
   * paths that aren't driven by a route event: an operator 'Retry' on the routes
   * banner, and the session-poll's engine-reachable-again signal — both re-attempt
   * after the bounded refetch retry has exhausted and left the panel stale.
   */
  bumpRoutesEpoch(): void
  setConnection(c: ConnectionStatus): void
  setRoutes(r: WaypointFolderRoute[]): void
  setTasks(t: WaypointFolderTask[]): void
  setSessions(s: AgentSessionSummary[]): void
  setSessionsError(e: string | null): void
  setRoutesError(e: string | null): void
  setError(e: string | null): void
  selectRoute(id: string | null): void
  selectTask(id: string | null): void
  setActiveSession(id: string | null): void
}

export const useStore = create<UiState>((set, get) => ({
  connection: 'connecting',
  seq: 0,
  routes: [],
  tasks: [],
  sessions: [],
  transcripts: {},
  selectedRouteId: null,
  selectedTaskId: null,
  activeSessionId: null,
  routesEpoch: 0,
  sessionsError: null,
  routesError: null,
  error: null,

  applyMessage(msg) {
    if (msg.type === 'snapshot') {
      // A snapshot is the authoritative full state at its seq, so it is applied
      // and *re-bases* the seq high-water mark — even when msg.seq is LOWER than
      // the current mark. A lower-seq snapshot only arises on a (re)subscribe to
      // a restarted / seq-reset engine (the host sends exactly one snapshot per
      // fresh subscribe; resnapshot-on-reset is the documented recovery — see
      // engine-host event-hub.ts / ws.ts). Re-basing seq lets the subsequent
      // lower-seq events pass the event high-water guard below instead of
      // stranding routes/tasks. A genuinely-stale *duplicate* snapshot can't
      // occur on the protocol, so there is nothing to guard against here. The
      // fresh full state is also same-channel recovery evidence, so it clears
      // stale routes/WS errors.
      set({
        routes: msg.routes,
        tasks: msg.tasks,
        seq: msg.seq,
        connection: 'open',
        routesError: null,
        error: null,
      })
      return
    }
    if (msg.type === 'resnapshot') {
      set({ routesEpoch: get().routesEpoch + 1 })
      return
    }
    if (msg.type === 'error') {
      set({ error: msg.error })
      return
    }
    // msg.type === 'event'
    if (msg.seq <= get().seq) return
    if (msg.topic.startsWith('agent:')) {
      const record = msg.record as AgentEventRecord
      const transcripts = get().transcripts
      const current = transcripts[record.sessionId] ?? []
      if (record.idx != null && current.some((e) => e.idx === record.idx)) {
        set({ seq: msg.seq })
        return
      }
      set({ seq: msg.seq, transcripts: { ...transcripts, [record.sessionId]: [...current, record] } })
      return
    }
    set({ seq: msg.seq, routesEpoch: get().routesEpoch + 1 })
  },

  bumpRoutesEpoch: () => set({ routesEpoch: get().routesEpoch + 1 }),
  setConnection: (connection) => set({ connection }),
  setRoutes: (routes) => set({ routes }),
  setTasks: (tasks) => set({ tasks }),
  setSessions: (sessions) => set({ sessions }),
  setSessionsError: (sessionsError) => set({ sessionsError }),
  setRoutesError: (routesError) => set({ routesError }),
  setError: (error) => set({ error }),
  selectRoute: (selectedRouteId) => set({ selectedRouteId, selectedTaskId: null }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
}))
