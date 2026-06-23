import { useCallback, useEffect, useRef } from 'react'

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

const ROUTE_REFRESH_RETRIES = 3
const ROUTE_REFRESH_RETRY_MS = 2000

/** Throws (instead of silently no-op'ing) on a non-ok command envelope. */
function listField<K extends string, T>(env: { ok: boolean; error?: string }, action: string, key: K): T | undefined {
  if (!env.ok) throw new Error(env.error ?? `${action} failed`)
  return (env as unknown as Record<K, T>)[key]
}

function Console() {
  const client = useClient()
  const applyMessage = useStore((s) => s.applyMessage)
  const routesEpoch = useStore((s) => s.routesEpoch)
  const setRoutes = useStore((s) => s.setRoutes)
  const setTasks = useStore((s) => s.setTasks)
  const setSessions = useStore((s) => s.setSessions)
  const setError = useStore((s) => s.setError)
  const error = useStore((s) => s.error)

  const refreshSessions = useCallback(async () => {
    const res = (await client.cmd('agent.list')) as { ok: boolean; error?: string; sessions?: AgentSessionSummary[] }
    const sessions = listField<'sessions', AgentSessionSummary[]>(res, 'agent.list', 'sessions')
    if (sessions) setSessions(sessions)
    setError(null) // recovered: clear any stale outage banner
  }, [client, setSessions, setError])

  const refreshRoutes = useCallback(async () => {
    const routes = (await client.cmd('routes.list')) as { ok: boolean; error?: string; routes?: WaypointFolderRoute[] }
    const routeList = listField<'routes', WaypointFolderRoute[]>(routes, 'routes.list', 'routes')
    if (routeList) setRoutes(routeList)
    const tasks = (await client.cmd('tasks.list', {})) as { ok: boolean; error?: string; tasks?: WaypointFolderTask[] }
    const taskList = listField<'tasks', WaypointFolderTask[]>(tasks, 'tasks.list', 'tasks')
    if (taskList) setTasks(taskList)
    setError(null)
  }, [client, setRoutes, setTasks, setError])

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

  // Refetch routes/tasks whenever the epoch advances. The epoch is only marked
  // applied after a *successful* refresh, so a failed refetch retries (bounded)
  // and is also retriggered by the next route event that bumps the epoch.
  const appliedEpochRef = useRef(0)
  useEffect(() => {
    if (routesEpoch === appliedEpochRef.current) return
    const target = routesEpoch
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (remaining: number) => {
      void refreshRoutes()
        .then(() => {
          if (!cancelled) appliedEpochRef.current = target
        })
        .catch((err) => {
          if (cancelled) return
          setError(toMessage(err))
          if (remaining > 0) timer = setTimeout(() => attempt(remaining - 1), ROUTE_REFRESH_RETRY_MS)
        })
    }
    attempt(ROUTE_REFRESH_RETRIES)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [routesEpoch, refreshRoutes, setError])

  return (
    <>
      {error && (
        <div
          role="alert"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: '#7f1d1d', color: '#fff', padding: '4px 8px', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 360px', height: '100%' }}>
        <RoutesPanel />
        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <RouteGraph />
          <TaskDetail />
        </div>
        <AgentChat />
      </div>
    </>
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
