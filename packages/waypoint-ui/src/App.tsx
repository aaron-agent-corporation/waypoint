import { useEffect } from 'react'

import { AgentChat } from './components/AgentChat'
import { ConnectionGate } from './components/ConnectionGate'
import { RouteGraph } from './components/RouteGraph'
import { RoutesPanel } from './components/RoutesPanel'
import { TaskDetail } from './components/TaskDetail'
import { ClientProvider, useClient } from './engine/context'
import type { BrowserEngineClient } from './engine/client'
import { useStore } from './store'

function Console() {
  const client = useClient()
  const applyMessage = useStore((s) => s.applyMessage)
  const routesDirty = useStore((s) => s.routesDirty)
  const clearDirty = useStore((s) => s.clearDirty)
  const setRoutes = useStore((s) => s.setRoutes)
  const setTasks = useStore((s) => s.setTasks)
  const setSessions = useStore((s) => s.setSessions)

  async function refreshSessions() {
    const res = (await client.cmd('agent.list')) as { ok: boolean; sessions?: { id: string; intent: string; status: string; startedAt: string }[] }
    if (res.ok && res.sessions) setSessions(res.sessions)
  }

  async function refreshRoutes() {
    const routes = (await client.cmd('routes.list')) as { ok: boolean; routes?: unknown[] }
    if (routes.ok && routes.routes) setRoutes(routes.routes as never)
    const tasks = (await client.cmd('tasks.list', {})) as { ok: boolean; tasks?: unknown[] }
    if (tasks.ok && tasks.tasks) setTasks(tasks.tasks as never)
  }

  useEffect(() => {
    const unsubscribe = client.subscribe(['*'], applyMessage)
    void refreshSessions()
    const interval = setInterval(refreshSessions, 2000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  useEffect(() => {
    if (routesDirty) {
      void refreshRoutes()
      clearDirty()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesDirty])

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
