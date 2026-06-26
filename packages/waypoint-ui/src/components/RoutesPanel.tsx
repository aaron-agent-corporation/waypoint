import { useStore } from '../store'

export function RoutesPanel() {
  const routes = useStore((s) => s.routes)
  const sessions = useStore((s) => s.sessions)
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const selectRoute = useStore((s) => s.selectRoute)
  const setActiveSession = useStore((s) => s.setActiveSession)

  const recipeScope = useStore((s) => s.recipeScope)
  const setRecipeScope = useStore((s) => s.setRecipeScope)
  const recipesByQuest = useStore((s) => s.recipesByQuest)
  const recipesAll = useStore((s) => s.recipesAll)
  const recipesWarningsAll = useStore((s) => s.recipesWarningsAll)
  const selectedRecipeSlug = useStore((s) => s.selectedRecipeSlug)
  const selectRecipe = useStore((s) => s.selectRecipe)

  const activeQuest = routes.find((r) => r.id === selectedRouteId)?.quest
  const recipeList = recipeScope === 'all' ? recipesAll : activeQuest ? recipesByQuest[activeQuest] : undefined
  const warnCount = recipeScope === 'all' ? recipesWarningsAll?.length ?? 0 : 0

  const recipeBody = () => {
    if (recipeScope === 'route' && !activeQuest) return <li>Select a route to see its recipes.</li>
    if (recipeScope === 'all' && recipesAll === null) return <li>Loading catalog…</li>
    if (!recipeList || recipeList.length === 0) return <li>{recipeScope === 'all' ? 'No recipes in the catalog.' : 'No recipes for this quest.'}</li>
    return recipeList.map((r) => (
      <li key={r.slug}>
        <button
          type="button"
          onClick={() => selectRecipe(r.slug)}
          style={{ fontWeight: r.slug === selectedRecipeSlug ? 700 : 400, width: '100%', textAlign: 'left' }}
        >
          {r.name || r.slug}
        </button>
      </li>
    ))
  }

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

      <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Recipes</span>
        <span style={{ fontWeight: 400, fontSize: 12 }}>
          <button type="button" onClick={() => setRecipeScope('route')} style={{ fontWeight: recipeScope === 'route' ? 700 : 400 }}>
            Route
          </button>
          {' | '}
          <button type="button" onClick={() => setRecipeScope('all')} style={{ fontWeight: recipeScope === 'all' ? 700 : 400 }}>
            All
          </button>
        </span>
      </h3>
      {warnCount > 0 ? <div style={{ color: '#92400e', fontSize: 12 }}>⚠ {warnCount} unreadable</div> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{recipeBody()}</ul>

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
