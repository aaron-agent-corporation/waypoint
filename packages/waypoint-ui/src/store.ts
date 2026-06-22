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
  routesDirty: boolean
  error: string | null

  applyMessage(msg: EngineWsMessage): void
  setConnection(c: ConnectionStatus): void
  setRoutes(r: WaypointFolderRoute[]): void
  setTasks(t: WaypointFolderTask[]): void
  setSessions(s: AgentSessionSummary[]): void
  selectRoute(id: string | null): void
  selectTask(id: string | null): void
  setActiveSession(id: string | null): void
  clearDirty(): void
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
  routesDirty: false,
  error: null,

  applyMessage(msg) {
    if (msg.type === 'snapshot') {
      set({ routes: msg.routes, tasks: msg.tasks, seq: msg.seq, connection: 'open' })
      return
    }
    if (msg.type === 'resnapshot') {
      set({ routesDirty: true })
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
    set({ seq: msg.seq, routesDirty: true })
  },

  setConnection: (connection) => set({ connection }),
  setRoutes: (routes) => set({ routes }),
  setTasks: (tasks) => set({ tasks }),
  setSessions: (sessions) => set({ sessions }),
  selectRoute: (selectedRouteId) => set({ selectedRouteId, selectedTaskId: null }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  clearDirty: () => set({ routesDirty: false }),
}))
