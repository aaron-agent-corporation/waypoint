import { useCallback, useEffect } from 'react'

import { AgentChat } from './components/AgentChat'
import { ConnectionGate } from './components/ConnectionGate'
import { RouteGraph } from './components/RouteGraph'
import { RoutesPanel } from './components/RoutesPanel'
import { TaskDetail } from './components/TaskDetail'
import { ClientProvider, useClient } from './engine/context'
import type { BrowserEngineClient } from './engine/client'
import type { AgentSessionSummary, WaypointFolderRoute, WaypointFolderTask } from './engine/types'
import { useStore } from './store'

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function Console() {
  const client = useClient()
  const applyMessage = useStore((s) => s.applyMessage)
  const routesDirty = useStore((s) => s.routesDirty)
  const clearDirty = useStore((s) => s.clearDirty)
  const setRoutes = useStore((s) => s.setRoutes)
  const setTasks = useStore((s) => s.setTasks)
  const setSessions = useStore((s) => s.setSessions)
  const setError = useStore((s) => s.setError)

  const refreshSessions = useCallback(async () => {
    const res = (await client.cmd('agent.list')) as { ok: boolean; sessions?: AgentSessionSummary[] }
    if (res.ok && res.sessions) setSessions(res.sessions)
  }, [client, setSessions])

  const refreshRoutes = useCallback(async () => {
    const routes = (await client.cmd('routes.list')) as { ok: boolean; routes?: WaypointFolderRoute[] }
    if (routes.ok && routes.routes) setRoutes(routes.routes)
    const tasks = (await client.cmd('tasks.list', {})) as { ok: boolean; tasks?: WaypointFolderTask[] }
    if (tasks.ok && tasks.tasks) setTasks(tasks.tasks)
  }, [client, setRoutes, setTasks])

  useEffect(() => {
    const unsubscribe = client.subscribe(['*'], applyMessage)
    const reportError = (err: unknown) => setError(toMessage(err))
    void refreshSessions().catch(reportError)
    const interval = setInterval(() => void refreshSessions().catch(reportError), 2000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [client, applyMessage, refreshSessions, setError])

  useEffect(() => {
    if (!routesDirty) return
    void refreshRoutes()
      .then(() => clearDirty())
      .catch((err) => setError(toMessage(err)))
  }, [routesDirty, refreshRoutes, clearDirty, setError])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 360px', height: '100%' }}>
      <RoutesPanel />
      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
        <RouteGraph />
        <TaskDetail />
      </div>
      <AgentChat />
    </div>
  )
}

export function App({ client }: { client: BrowserEngineClient }) {
  return (
    <ClientProvider client={client}>
      <ConnectionGate>
        <Console />
      </ConnectionGate>
    </ClientProvider>
  )
}
