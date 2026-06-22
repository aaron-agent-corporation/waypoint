import { useStore } from '../store'

export function RoutesPanel() {
  const routes = useStore((s) => s.routes)
  const sessions = useStore((s) => s.sessions)
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const selectRoute = useStore((s) => s.selectRoute)
  const setActiveSession = useStore((s) => s.setActiveSession)

  return (
    <nav style={{ borderRight: '1px solid #ddd', overflowY: 'auto', padding: 8, fontSize: 13 }}>
      <h3>Routes</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {routes.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => selectRoute(r.id)}
              style={{ fontWeight: r.id === selectedRouteId ? 700 : 400, width: '100%', textAlign: 'left' }}
            >
              {r.id} · {r.status}
            </button>
          </li>
        ))}
        {routes.length === 0 ? <li>(no routes)</li> : null}
      </ul>

      <h3>Sessions</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setActiveSession(s.id)}
              style={{ fontWeight: s.id === activeSessionId ? 700 : 400, width: '100%', textAlign: 'left' }}
            >
              {s.id} · {s.status} — {s.intent}
            </button>
          </li>
        ))}
        {sessions.length === 0 ? <li>(no sessions)</li> : null}
      </ul>
    </nav>
  )
}
