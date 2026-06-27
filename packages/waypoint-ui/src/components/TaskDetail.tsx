import { RecipeCard } from './RecipeCard'
import { resolveRecipe } from '../recipe'
import { useStore } from '../store'

export function TaskDetail() {
  const selectedRecipeSlug = useStore((s) => s.selectedRecipeSlug)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const task = useStore((s) => s.tasks.find((t) => t.id === selectedTaskId))
  const routes = useStore((s) => s.routes)
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const recipesByQuest = useStore((s) => s.recipesByQuest)
  const recipesAll = useStore((s) => s.recipesAll)

  if (selectedRecipeSlug) {
    const quest = routes.find((r) => r.id === selectedRouteId)?.quest
    const recipe = resolveRecipe(selectedRecipeSlug, quest, { recipesByQuest, recipesAll })
    // Distinguish "not fetched yet" (show Loading…) from "fetched, genuinely
    // absent" (show not-found). A node-selected recipe belongs to the active
    // route's quest, so with a route selected the quest cache is the authoritative
    // source — gate on IT, not on recipesAll. Otherwise a loaded global list would
    // declare a quest recipe "not found" during the window before its quest cache
    // arrives (P2 flash). With no active quest, fall back to the global list.
    const cacheResolved = quest != null ? recipesByQuest[quest] !== undefined : recipesAll !== null
    return (
      <div style={{ borderTop: '1px solid #ddd', overflow: 'auto' }}>
        {task ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0, padding: '8px 12px 0', fontSize: 12 }}>
            <dt>task</dt><dd>{task.plan_ref}</dd>
            <dt>status</dt><dd>{task.status}</dd>
          </dl>
        ) : null}
        <RecipeCard recipe={recipe} slug={selectedRecipeSlug} loading={!recipe && !cacheResolved} />
      </div>
    )
  }

  if (!task) return <div style={{ padding: 12, fontSize: 13 }}>Select a node or recipe.</div>

  return (
    <div style={{ padding: 12, fontSize: 13, borderTop: '1px solid #ddd' }}>
      <h4 style={{ margin: '0 0 8px' }}>{task.plan_ref}</h4>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0 }}>
        <dt>id</dt><dd>{task.id}</dd>
        <dt>kind</dt><dd>{task.kind}</dd>
        <dt>status</dt><dd>{task.status}</dd>
        <dt>phase</dt><dd>{task.phase}</dd>
        <dt>wave</dt><dd>{task.wave ?? '—'}</dd>
      </dl>
      {task.metadata ? (
        <details style={{ marginTop: 8 }}>
          <summary>metadata</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(task.metadata, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  )
}
