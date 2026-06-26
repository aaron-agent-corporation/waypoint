import type { Recipe } from '../recipe'

export function RecipeCard({ recipe, slug }: { recipe: Recipe | undefined; slug: string }) {
  if (!recipe) {
    return (
      <div style={{ padding: 12, fontSize: 13 }}>
        Recipe <code>{slug}</code> not found in the loaded catalog.
      </div>
    )
  }
  const tools = recipe.tools ?? []
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h4 style={{ margin: '0 0 2px' }}>{recipe.name || recipe.slug}</h4>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>{recipe.slug}</div>
      <p style={{ margin: '0 0 8px' }}>{recipe.description || 'No description'}</p>
      <div style={{ marginBottom: 8 }}>
        {tools.length > 0 ? (
          tools.map((t) => (
            <span
              key={t}
              style={{ display: 'inline-block', background: '#eee', borderRadius: 4, padding: '1px 6px', marginRight: 4, fontSize: 12 }}
            >
              {t}
            </span>
          ))
        ) : (
          <span style={{ color: '#666' }}>No tool grants</span>
        )}
      </div>
      <details>
        <summary>prompt</summary>
        {recipe.prompt ? (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, maxHeight: '50vh', overflow: 'auto' }}>
            {recipe.prompt}
          </pre>
        ) : (
          <div style={{ color: '#666' }}>No prompt defined.</div>
        )}
      </details>
    </div>
  )
}
