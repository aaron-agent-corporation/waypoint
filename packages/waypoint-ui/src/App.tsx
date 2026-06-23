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
  const setSessionsError = useStore((s) => s.setSessionsError)
  const setRoutesError = useStore((s) => s.setRoutesError)
  const setError = useStore((s) => s.setError)
  const sessionsError = useStore((s) => s.sessionsError)
  const routesError = useStore((s) => s.routesError)
  const error = useStore((s) => s.error)

  // Pure fetchers: they never touch the store. The caller applies the result
  // (and clears the error) under a freshness guard, so a stale in-flight
  // response can't roll the store back or wipe a freshly-raised error.
  const fetchSessions = useCallback(async (): Promise<AgentSessionSummary[] | undefined> => {
    const res = (await client.cmd('agent.list')) as { ok: boolean; error?: string; sessions?: AgentSessionSummary[] }
    return listField<'sessions', AgentSessionSummary[]>(res, 'agent.list', 'sessions')
  }, [client])

  const fetchRoutes = useCallback(async (): Promise<{ routes?: WaypointFolderRoute[]; tasks?: WaypointFolderTask[] }> => {
    const routesEnv = (await client.cmd('routes.list')) as { ok: boolean; error?: string; routes?: WaypointFolderRoute[] }
    const routes = listField<'routes', WaypointFolderRoute[]>(routesEnv, 'routes.list', 'routes')
    const tasksEnv = (await client.cmd('tasks.list', {})) as { ok: boolean; error?: string; tasks?: WaypointFolderTask[] }
    const tasks = listField<'tasks', WaypointFolderTask[]>(tasksEnv, 'tasks.list', 'tasks')
    return { routes, tasks }
  }, [client])

  // Subscribe + single-flight session poll. The poll is a recursive setTimeout
  // (not setInterval): the next agent.list starts only after the previous one
  // *settles*, so a slow endpoint can't overlap itself and starve — and there's
  // only ever one in-flight request, so no stale-completion race. The `active`
  // flag also guards the WS callback: a late message from a closed/superseded
  // socket is dropped before it can roll the store back (snapshots are now
  // authoritative and re-base seq, so this guard is load-bearing).
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = client.subscribe(['*'], (msg) => {
      if (active) applyMessage(msg)
    })
    const poll = async () => {
      try {
        const sessions = await fetchSessions()
        if (!active) return
        if (sessions) setSessions(sessions)
        setSessionsError(null) // recovered
      } catch (err) {
        if (active) setSessionsError(toMessage(err))
      } finally {
        if (active) timer = setTimeout(poll, 2000)
      }
    }
    void poll()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [client, applyMessage, fetchSessions, setSessions, setSessionsError])

  // Refetch routes/tasks whenever the epoch advances. The epoch is marked applied
  // — and the data/error writes happen — only for the *live* attempt (`!cancelled`),
  // so a stale response from a superseded epoch can't roll the store back. A failed
  // refetch retries (bounded). NOTE: once the bounded retry exhausts, routes/tasks
  // are not re-fetched until the next epoch bump (a route event/resnapshot) — there
  // is no independent routes poll. This is intended; a longer engine blip leaves the
  // route panel stale (banner up) until the next event, while the session poll
  // recovers on its own 2s cadence.
  const appliedEpochRef = useRef(0)
  useEffect(() => {
    if (routesEpoch === appliedEpochRef.current) return
    const target = routesEpoch
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = (remaining: number) => {
      void fetchRoutes()
        .then(({ routes, tasks }) => {
          if (cancelled) return
          if (routes) setRoutes(routes)
          if (tasks) setTasks(tasks)
          setRoutesError(null)
          appliedEpochRef.current = target
        })
        .catch((err) => {
          if (cancelled) return
          setRoutesError(toMessage(err))
          if (remaining > 0) timer = setTimeout(() => attempt(remaining - 1), ROUTE_REFRESH_RETRY_MS)
        })
    }
    attempt(ROUTE_REFRESH_RETRIES)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [routesEpoch, fetchRoutes, setRoutes, setTasks, setRoutesError])

  // Per-source rows so dismissing a recovered source can't hide a still-active
  // outage on another (routesError has no independent poll, so a shared Dismiss
  // would leave it silently hidden until the next route event).
  const errors: { key: string; msg: string; clear: () => void }[] = []
  if (routesError) errors.push({ key: 'routes', msg: routesError, clear: () => setRoutesError(null) })
  if (sessionsError) errors.push({ key: 'sessions', msg: sessionsError, clear: () => setSessionsError(null) })
  if (error) errors.push({ key: 'engine', msg: error, clear: () => setError(null) })

  return (
    <div style={{ display: 'grid', gridTemplateRows: errors.length ? 'auto 1fr' : '1fr', height: '100%' }}>
      {errors.length > 0 && (
        <div role="alert" style={{ background: '#7f1d1d', color: '#fff', fontSize: 12 }}>
          {errors.map((e) => (
            <div key={e.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px' }}>
              <span>{e.msg}</span>
              <button onClick={e.clear} style={{ marginLeft: 8 }}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 360px', minHeight: 0 }}>
        <RoutesPanel />
        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <RouteGraph />
          <TaskDetail />
        </div>
        <AgentChat />
      </div>
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
