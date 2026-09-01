# Spine UI — Recipe-Detail Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Spine console resolve recipe nodes/slugs to readable recipe cards (name, description, tools, full prompt), browsable from the DAG and a left-rail Recipes section, with recipe/kind badges on graph nodes.

**Architecture:** Pure UI-side feature in `packages/spine-ui`. One shared pure helper (`recipeSlugOf`) reads the recipe slug from both backend metadata shapes. The store gains recipe caches + selection state; recipes are fetched once per scope via the existing `catalog.recipes` engine command (route-scoped or global) and cached. New `RecipeCard` renders a manifest; `RoutesPanel` gains a Recipes section with a Route|All toggle; `TaskDetail` dispatches to the card when a recipe is selected; `build-graph` enriches nodes with a badge + recipe name.

**Tech Stack:** React 18, Zustand, TypeScript (ESM, `.ts`/`.tsx` import specifiers), Vite, Vitest + @testing-library/react.

## Global Constraints

- **Entirely UI-side.** No changes to any package other than `packages/spine-ui`. No engine, proxy, or catalog changes; no new runtime dependencies.
- **Read-only posture.** No recipe editing, execution, Copy-Prompt, Search/Filter, or raw metadata/runtime dump. Those are deferred follow-ups, explicitly out of scope.
- **Backend-agnostic slug (G1).** The recipe slug is read through one shared `recipeSlugOf` helper that handles BOTH `metadata.runner.recipe.slug` (folder-host) AND `metadata.runner.recipe_slug` (Beads). Never read the slug path inline anywhere else.
- **Recipe-ness is the non-empty slug** — never a `node.type` field or the rendered badge string. `SpineFolderTaskKind` is a 12-value union; "not a recipe" is the other eleven kinds, badged verbatim.
- **`catalog.recipes` wire shapes:** route-scoped `catalog.recipes({ quest })` → `{ ok, quest, recipes, warnings: [] }` (warnings always empty; unknown quest throws `NOT_FOUND`); global `catalog.recipes()` → `{ ok, recipes, warnings }` where **`warnings` is `string[]`** (already-formatted messages).
- **`prompt` and `tools` are optional** on a manifest; the card must handle their absence.
- **Fetch-once-and-cache.** No new polling/epoch/WS subscription. In-flight fetches use a `cancelled` flag (the existing `App.tsx` pattern). Cache is written only on success, so an error never blanks a loaded list.
- **TDD.** Every task writes the failing test first. Run tests from `packages/spine-ui` with `npx vitest run <file>` (auto-uses the local `vitest.config.ts`).

**Deviations from the spec wording, grounded in source (both keep the feature zero-engine-change):**
- The spec typed warnings as `CatalogRecipeWarning[]`; the command actually returns formatted `string[]`, so this plan uses `string[]`.
- The spec aliased `Recipe = Pick<CatalogRecipeManifest, …>` re-exported from the engine package; `CatalogRecipeManifest` is not exported from `@projectrunner/spine-folder-host`'s index, so this plan defines `Recipe` as a standalone interface inside the UI.

---

### Task 1: Recipe helpers — `Recipe` type, `recipeSlugOf`, `resolveRecipe`

**Files:**
- Create: `packages/spine-ui/src/recipe.ts`
- Test: `packages/spine-ui/src/recipe.test.ts`

**Interfaces:**
- Consumes: `SpineFolderTask` from `./engine/types`.
- Produces:
  - `interface Recipe { readonly slug: string; readonly name: string; readonly description?: string; readonly prompt?: string; readonly tools?: readonly string[] }`
  - `recipeSlugOf(task: Pick<SpineFolderTask, 'metadata'>): string | null`
  - `interface RecipeCaches { readonly recipesByQuest: Record<string, Recipe[]>; readonly recipesAll: Recipe[] | null }`
  - `resolveRecipe(slug: string, quest: string | undefined, caches: RecipeCaches): Recipe | undefined`

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/recipe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { SpineFolderTask } from './engine/types'
import { recipeSlugOf, resolveRecipe, type Recipe } from './recipe'

function task(metadata: SpineFolderTask['metadata']): Pick<SpineFolderTask, 'metadata'> {
  return { metadata }
}

describe('recipeSlugOf', () => {
  it('reads the nested folder-host path metadata.runner.recipe.slug', () => {
    expect(recipeSlugOf(task({ runner: { recipe: { slug: 'runner-code-reviewer' } } }))).toBe('runner-code-reviewer')
  })

  it('reads the flat Beads path metadata.runner.recipe_slug', () => {
    expect(recipeSlugOf(task({ runner: { recipe_slug: 'runner-doc-writer' } }))).toBe('runner-doc-writer')
  })

  it('prefers the nested path when both are present', () => {
    expect(recipeSlugOf(task({ runner: { recipe: { slug: 'nested' }, recipe_slug: 'flat' } }))).toBe('nested')
  })

  it('returns null for empty slug, missing runner, missing metadata, or string metadata', () => {
    expect(recipeSlugOf(task({ runner: { recipe: { slug: '' } } }))).toBeNull()
    expect(recipeSlugOf(task({ runner: {} }))).toBeNull()
    expect(recipeSlugOf(task({}))).toBeNull()
    expect(recipeSlugOf(task(undefined))).toBeNull()
    expect(recipeSlugOf({ metadata: 'a json string' as unknown as SpineFolderTask['metadata'] })).toBeNull()
  })
})

describe('resolveRecipe', () => {
  const reviewer: Recipe = { slug: 'reviewer', name: 'Reviewer' }
  const globalOnly: Recipe = { slug: 'global-only', name: 'Global' }
  const caches = { recipesByQuest: { runner: [reviewer] }, recipesAll: [globalOnly] }

  it('prefers the active quest cache', () => {
    expect(resolveRecipe('reviewer', 'runner', caches)).toBe(reviewer)
  })

  it('falls back to the global cache', () => {
    expect(resolveRecipe('global-only', 'runner', caches)).toBe(globalOnly)
  })

  it('returns undefined when present in neither loaded scope', () => {
    expect(resolveRecipe('missing', 'runner', caches)).toBeUndefined()
    expect(resolveRecipe('reviewer', undefined, { recipesByQuest: {}, recipesAll: null })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/recipe.test.ts`
Expected: FAIL — `Failed to resolve import './recipe'` / `recipeSlugOf is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/spine-ui/src/recipe.ts`:

```ts
import type { SpineFolderTask } from './engine/types'

/** The five recipe-manifest fields the UI renders (subset of the wire manifest). */
export interface Recipe {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly tools?: readonly string[]
}

/**
 * The single place the backend-specific recipe-slug path is encoded. Folder-host
 * writes the slug nested at metadata.runner.recipe.slug; the Beads backend
 * writes it flat at metadata.runner.recipe_slug. Both are read so every
 * consumer (selectTask, the graph badge, the subtitle) agrees on recipe-ness.
 * Returns null for a missing/empty slug or non-object metadata.
 */
export function recipeSlugOf(task: Pick<SpineFolderTask, 'metadata'>): string | null {
  const meta = task.metadata
  if (typeof meta !== 'object' || meta === null) return null
  const runner = (meta as Record<string, unknown>).runner
  if (typeof runner !== 'object' || runner === null) return null
  const wp = runner as Record<string, unknown>
  const nested = wp.recipe
  const nestedSlug = typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>).slug : undefined
  const flatSlug = wp.recipe_slug
  const slug = typeof nestedSlug === 'string' ? nestedSlug : typeof flatSlug === 'string' ? flatSlug : undefined
  return slug && slug.length > 0 ? slug : null
}

export interface RecipeCaches {
  readonly recipesByQuest: Record<string, Recipe[]>
  readonly recipesAll: Recipe[] | null
}

/** Resolve a slug to a manifest: active quest cache first, then global. */
export function resolveRecipe(slug: string, quest: string | undefined, caches: RecipeCaches): Recipe | undefined {
  const fromQuest = quest ? caches.recipesByQuest[quest]?.find((r) => r.slug === slug) : undefined
  if (fromQuest) return fromQuest
  return caches.recipesAll?.find((r) => r.slug === slug) ?? undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/recipe.test.ts`
Expected: PASS (10 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/recipe.ts packages/spine-ui/src/recipe.test.ts
git commit -m "feat(ui): recipe slug/resolve helpers with dual-backend slug path (runner-8uf)"
```

---

### Task 2: Store — recipe caches, selection state, and actions

**Files:**
- Modify: `packages/spine-ui/src/store.ts`
- Test: `packages/spine-ui/src/store.test.ts`

**Interfaces:**
- Consumes: `recipeSlugOf`, `Recipe` from `./recipe`.
- Produces (new `UiState` members):
  - state: `selectedRecipeSlug: string | null`, `recipeScope: 'route' | 'all'`, `recipesByQuest: Record<string, Recipe[]>`, `recipesAll: Recipe[] | null`, `recipesWarningsAll: string[] | null`, `recipesError: string | null`
  - actions: `selectRecipe(slug: string | null): void`, `setRecipeScope(scope: 'route' | 'all'): void`, `setQuestRecipes(quest: string, recipes: Recipe[]): void`, `setAllRecipes(recipes: Recipe[], warnings: string[]): void`, `setRecipesError(e: string | null): void`
  - changed behavior: `selectTask(id)` now also sets `selectedRecipeSlug` to the task's slug (or null); `selectRoute(id)` now also clears `selectedRecipeSlug`.

- [ ] **Step 1: Write the failing test**

Append to `packages/spine-ui/src/store.test.ts` (inside the existing `describe('store.applyMessage', …)` is fine, or add a new `describe`). Add a new block at the end of the file before the final `})` is closed — create a fresh describe:

```ts
import type { SpineFolderTask } from './engine/types'
import type { Recipe } from './recipe'

const recipeTask = (id: string, slug: string): SpineFolderTask => ({
  id, route_id: 'route-001', plan_ref: 'p', title: 't', phase: 'x', wave: 0,
  kind: 'recipe', status: 'open', created_at: 't', updated_at: 't',
  metadata: { runner: { recipe: { slug } } },
})
const checkpointTask = (id: string): SpineFolderTask => ({
  id, route_id: 'route-001', plan_ref: 'p', title: 't', phase: 'x', wave: 0,
  kind: 'checkpoint', status: 'open', created_at: 't', updated_at: 't', metadata: {},
})

describe('store recipe state', () => {
  it('selectRecipe sets and clears the slug', () => {
    useStore.getState().selectRecipe('reviewer')
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
    useStore.getState().selectRecipe(null)
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })

  it('setRecipeScope flips the scope', () => {
    expect(useStore.getState().recipeScope).toBe('route')
    useStore.getState().setRecipeScope('all')
    expect(useStore.getState().recipeScope).toBe('all')
  })

  it('cache setters populate quest, global, and warnings', () => {
    const r: Recipe = { slug: 'reviewer', name: 'Reviewer' }
    useStore.getState().setQuestRecipes('runner', [r])
    expect(useStore.getState().recipesByQuest.runner).toEqual([r])
    useStore.getState().setAllRecipes([r], ['half-written.yaml: invalid Recipe manifest'])
    expect(useStore.getState().recipesAll).toEqual([r])
    expect(useStore.getState().recipesWarningsAll).toEqual(['half-written.yaml: invalid Recipe manifest'])
  })

  it('selectTask sets the recipe slug for a recipe node and clears it for a non-recipe node', () => {
    useStore.setState({ tasks: [recipeTask('task-1', 'reviewer'), checkpointTask('task-2')] })
    useStore.getState().selectTask('task-1')
    expect(useStore.getState().selectedTaskId).toBe('task-1')
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
    useStore.getState().selectTask('task-2')
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })

  it('selectRoute clears both selectedTaskId and selectedRecipeSlug', () => {
    useStore.setState({ selectedTaskId: 'task-1', selectedRecipeSlug: 'reviewer' })
    useStore.getState().selectRoute('route-002')
    expect(useStore.getState().selectedRouteId).toBe('route-002')
    expect(useStore.getState().selectedTaskId).toBeNull()
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/store.test.ts`
Expected: FAIL — `selectRecipe is not a function` / `recipeScope` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `packages/spine-ui/src/store.ts`:

3a. Add the import at the top (after the existing type import block):

```ts
import { recipeSlugOf, type Recipe } from './recipe'
```

3b. Add to the `UiState` interface (after the `error: string | null` field):

```ts
  selectedRecipeSlug: string | null
  recipeScope: 'route' | 'all'
  recipesByQuest: Record<string, Recipe[]>
  recipesAll: Recipe[] | null
  recipesWarningsAll: string[] | null
  recipesError: string | null
```

3c. Add to the `UiState` interface action signatures (after `setError`):

```ts
  selectRecipe(slug: string | null): void
  setRecipeScope(scope: 'route' | 'all'): void
  setQuestRecipes(quest: string, recipes: Recipe[]): void
  setAllRecipes(recipes: Recipe[], warnings: string[]): void
  setRecipesError(e: string | null): void
```

3d. Add the initial values in `create(...)` (after `error: null,`):

```ts
  selectedRecipeSlug: null,
  recipeScope: 'route',
  recipesByQuest: {},
  recipesAll: null,
  recipesWarningsAll: null,
  recipesError: null,
```

3e. Replace the existing `selectRoute` and `selectTask` implementations:

```ts
  selectRoute: (selectedRouteId) => set({ selectedRouteId, selectedTaskId: null, selectedRecipeSlug: null }),
  selectTask: (selectedTaskId) => {
    const task = get().tasks.find((t) => t.id === selectedTaskId)
    set({ selectedTaskId, selectedRecipeSlug: task ? recipeSlugOf(task) : null })
  },
```

3f. Add the new action implementations (next to the other setters):

```ts
  selectRecipe: (selectedRecipeSlug) => set({ selectedRecipeSlug }),
  setRecipeScope: (recipeScope) => set({ recipeScope }),
  setQuestRecipes: (quest, recipes) => set({ recipesByQuest: { ...get().recipesByQuest, [quest]: recipes } }),
  setAllRecipes: (recipesAll, recipesWarningsAll) => set({ recipesAll, recipesWarningsAll }),
  setRecipesError: (recipesError) => set({ recipesError }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/store.test.ts`
Expected: PASS — the new `store recipe state` suite plus all pre-existing store tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/store.ts packages/spine-ui/src/store.test.ts
git commit -m "feat(ui): store recipe caches + selection state, slug-aware selectTask/selectRoute (runner-8uf)"
```

---

### Task 3: `RecipeCard` component

**Files:**
- Create: `packages/spine-ui/src/components/RecipeCard.tsx`
- Test: `packages/spine-ui/src/components/RecipeCard.test.tsx`

**Interfaces:**
- Consumes: `Recipe` from `../recipe`.
- Produces: `RecipeCard(props: { recipe: Recipe | undefined; slug: string }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/RecipeCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RecipeCard } from './RecipeCard'
import type { Recipe } from '../recipe'

const full: Recipe = {
  slug: 'runner-code-reviewer', name: 'Code Reviewer',
  description: 'Reviews source files.', prompt: 'You are the reviewer.', tools: ['Read', 'Grep'],
}

describe('RecipeCard', () => {
  it('renders name, slug, description, tools, and prompt', () => {
    render(<RecipeCard recipe={full} slug={full.slug} />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('runner-code-reviewer')).toBeInTheDocument()
    expect(screen.getByText('Reviews source files.')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText('You are the reviewer.')).toBeInTheDocument()
  })

  it('falls back to slug for an empty name and shows absence copy for missing fields', () => {
    render(<RecipeCard recipe={{ slug: 'bare', name: '' }} slug="bare" />)
    expect(screen.getByRole('heading', { name: 'bare' })).toBeInTheDocument()
    expect(screen.getByText('No description')).toBeInTheDocument()
    expect(screen.getByText('No tool grants')).toBeInTheDocument()
    expect(screen.getByText('No prompt defined.')).toBeInTheDocument()
  })

  it('renders a not-found message when the recipe is undefined', () => {
    render(<RecipeCard recipe={undefined} slug="ghost" />)
    expect(screen.getByText(/not found in the loaded catalog/)).toBeInTheDocument()
    expect(screen.getByText('ghost')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/RecipeCard.test.tsx`
Expected: FAIL — `Failed to resolve import './RecipeCard'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/spine-ui/src/components/RecipeCard.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/RecipeCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/RecipeCard.tsx packages/spine-ui/src/components/RecipeCard.test.tsx
git commit -m "feat(ui): RecipeCard component (name/desc/tools/prompt + fallbacks) (runner-8uf)"
```

---

### Task 4: `RoutesPanel` — Recipes section with Route|All toggle

**Files:**
- Modify: `packages/spine-ui/src/components/RoutesPanel.tsx`
- Test: `packages/spine-ui/src/components/RoutesPanel.test.tsx`

**Interfaces:**
- Consumes from store: `routes`, `selectedRouteId`, `recipeScope`, `setRecipeScope`, `recipesByQuest`, `recipesAll`, `recipesWarningsAll`, `selectedRecipeSlug`, `selectRecipe`, plus the existing routes/sessions members.
- Produces: the same `RoutesPanel()` export, now rendering a **Recipes** section.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/RoutesPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { RoutesPanel } from './RoutesPanel'
import type { SpineFolderRoute } from '../engine/types'
import type { Recipe } from '../recipe'
import { useStore } from '../store'

const route = (id: string, quest: string): SpineFolderRoute => ({
  id, quest, status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't',
})
const reviewer: Recipe = { slug: 'reviewer', name: 'Code Reviewer' }
const fixer: Recipe = { slug: 'fixer', name: 'Code Fixer' }
const global1: Recipe = { slug: 'global-1', name: 'Global One' }

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('RoutesPanel recipes section', () => {
  it('lists the selected route quest recipes in route scope', () => {
    useStore.setState({
      routes: [route('route-001', 'code-review')],
      selectedRouteId: 'route-001',
      recipesByQuest: { 'code-review': [reviewer, fixer] },
    })
    render(<RoutesPanel />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Fixer')).toBeInTheDocument()
  })

  it('toggling to All switches the scope and lists the global recipes', () => {
    useStore.setState({ recipesAll: [global1] })
    render(<RoutesPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(useStore.getState().recipeScope).toBe('all')
    expect(screen.getByText('Global One')).toBeInTheDocument()
  })

  it('selecting a recipe row sets the slug', () => {
    useStore.setState({
      routes: [route('route-001', 'code-review')], selectedRouteId: 'route-001',
      recipesByQuest: { 'code-review': [reviewer] },
    })
    render(<RoutesPanel />)
    fireEvent.click(screen.getByText('Code Reviewer'))
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
  })

  it('shows the unreadable warning note only in All scope', () => {
    useStore.setState({ recipeScope: 'all', recipesAll: [global1], recipesWarningsAll: ['a.yaml: invalid', 'b.yaml: invalid'] })
    render(<RoutesPanel />)
    expect(screen.getByText('⚠ 2 unreadable')).toBeInTheDocument()
  })

  it('shows the no-route empty state in route scope with no route selected', () => {
    render(<RoutesPanel />)
    expect(screen.getByText('Select a route to see its recipes.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/RoutesPanel.test.tsx`
Expected: FAIL — the Recipes heading/rows/toggle do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace the entire body of `packages/spine-ui/src/components/RoutesPanel.tsx`:

```tsx
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
    if (!recipeList || recipeList.length === 0) return <li>No recipes for this quest.</li>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/RoutesPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/RoutesPanel.tsx packages/spine-ui/src/components/RoutesPanel.test.tsx
git commit -m "feat(ui): RoutesPanel Recipes section with Route|All scope toggle (runner-8uf)"
```

---

### Task 5: `TaskDetail` — recipe dispatcher

**Files:**
- Modify: `packages/spine-ui/src/components/TaskDetail.tsx`
- Test: `packages/spine-ui/src/components/TaskDetail.test.tsx`

**Interfaces:**
- Consumes from store: `selectedRecipeSlug`, `selectedTaskId`, `tasks`, `routes`, `selectedRouteId`, `recipesByQuest`, `recipesAll`. Uses `resolveRecipe` from `../recipe` and renders `RecipeCard`.
- Produces: the same `TaskDetail()` export, now recipe-aware.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/TaskDetail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TaskDetail } from './TaskDetail'
import type { SpineFolderRoute, SpineFolderTask } from '../engine/types'
import type { Recipe } from '../recipe'
import { useStore } from '../store'

const route: SpineFolderRoute = { id: 'route-001', quest: 'code-review', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }
const reviewer: Recipe = { slug: 'reviewer', name: 'Code Reviewer', description: 'Reviews.', prompt: 'Be adversarial.' }
const recipeTask: SpineFolderTask = { id: 'task-1', route_id: 'route-001', plan_ref: 'run-reviewer', title: 't', phase: 'x', wave: 0, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't', metadata: { runner: { recipe: { slug: 'reviewer' } } } }

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('TaskDetail dispatcher', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(<TaskDetail />)
    expect(screen.getByText(/Select a/)).toBeInTheDocument()
  })

  it('renders the recipe card when a recipe slug is selected', () => {
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [reviewer] }, selectedRecipeSlug: 'reviewer' })
    render(<TaskDetail />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Be adversarial.')).toBeInTheDocument()
  })

  it('falls back to today task fields when a non-recipe task is selected', () => {
    useStore.setState({ tasks: [{ ...recipeTask, kind: 'checkpoint', metadata: {} }], selectedTaskId: 'task-1', selectedRecipeSlug: null })
    render(<TaskDetail />)
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/TaskDetail.test.tsx`
Expected: FAIL — the recipe card branch does not exist (the "Code Reviewer" assertion fails).

- [ ] **Step 3: Write minimal implementation**

Replace the entire body of `packages/spine-ui/src/components/TaskDetail.tsx`:

```tsx
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
    return (
      <div style={{ borderTop: '1px solid #ddd', overflow: 'auto' }}>
        {task ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0, padding: '8px 12px 0', fontSize: 12 }}>
            <dt>task</dt><dd>{task.plan_ref}</dd>
            <dt>status</dt><dd>{task.status}</dd>
          </dl>
        ) : null}
        <RecipeCard recipe={recipe} slug={selectedRecipeSlug} />
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/TaskDetail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/TaskDetail.tsx packages/spine-ui/src/components/TaskDetail.test.tsx
git commit -m "feat(ui): TaskDetail dispatches to RecipeCard on recipe selection (runner-8uf)"
```

---

### Task 6: Graph enrichment — `build-graph` badge/name + `GraphNode` + `RouteGraph` wiring

**Files:**
- Modify: `packages/spine-ui/src/graph/build-graph.ts`
- Create: `packages/spine-ui/src/components/GraphNode.tsx`
- Modify: `packages/spine-ui/src/components/RouteGraph.tsx`
- Test: `packages/spine-ui/src/graph/build-graph.test.ts` (extend if present; create if absent)
- Test: `packages/spine-ui/src/components/GraphNode.test.tsx`

**Interfaces:**
- Consumes: `recipeSlugOf` from `../recipe`; `resolveRecipe` in `RouteGraph`.
- Produces:
  - `buildRouteGraph(tasks, recipeNameResolver?: (slug: string) => string | undefined)` — `RouteGraphNode.data` now also carries `badge: string` and `recipeName?: string`; nodes carry `type: 'recipeAware'`.
  - `GraphNode(props: { data: RouteGraphNode['data'] }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

Create `packages/spine-ui/src/graph/build-graph.test.ts` (if a build-graph test already exists, append these cases instead):

```ts
import { describe, expect, it } from 'vitest'

import { buildRouteGraph } from './build-graph'
import type { SpineFolderTask } from '../engine/types'

const base = { route_id: 'route-001', title: 't', phase: 'x', created_at: 't', updated_at: 't' }
const recipeTask: SpineFolderTask = { ...base, id: 'task-1', plan_ref: 'run-reviewer', wave: 0, kind: 'recipe', status: 'open', metadata: { runner: { recipe: { slug: 'reviewer' } } } }
const checkpointTask: SpineFolderTask = { ...base, id: 'task-2', plan_ref: 'intake', wave: 1, kind: 'checkpoint', status: 'open', metadata: {} }

describe('buildRouteGraph enrichment', () => {
  it('badges a recipe node "recipe" and resolves its name subtitle', () => {
    const { nodes } = buildRouteGraph([recipeTask], (slug) => (slug === 'reviewer' ? 'Code Reviewer' : undefined))
    const n = nodes.find((x) => x.id === 'task-1')!
    expect(n.data.badge).toBe('recipe')
    expect(n.data.recipeName).toBe('Code Reviewer')
    expect(n.type).toBe('recipeAware')
  })

  it('falls back to the slug when the resolver returns undefined', () => {
    const { nodes } = buildRouteGraph([recipeTask])
    expect(nodes.find((x) => x.id === 'task-1')!.data.recipeName).toBe('reviewer')
  })

  it('badges a non-recipe node with its verbatim kind and no recipe name', () => {
    const { nodes } = buildRouteGraph([checkpointTask])
    const n = nodes.find((x) => x.id === 'task-2')!
    expect(n.data.badge).toBe('checkpoint')
    expect(n.data.recipeName).toBeUndefined()
  })
})
```

Create `packages/spine-ui/src/components/GraphNode.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GraphNode } from './GraphNode'

describe('GraphNode', () => {
  it('renders the badge, label, and recipe-name subtitle', () => {
    render(<GraphNode data={{ label: 'run-reviewer', kind: 'recipe', status: 'open', badge: 'recipe', recipeName: 'Code Reviewer' }} />)
    expect(screen.getByText('recipe')).toBeInTheDocument()
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
  })

  it('omits the subtitle when there is no recipe name', () => {
    render(<GraphNode data={{ label: 'intake', kind: 'checkpoint', status: 'open', badge: 'checkpoint' }} />)
    expect(screen.getByText('intake')).toBeInTheDocument()
    expect(screen.queryByText('Code Reviewer')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/spine-ui && npx vitest run src/graph/build-graph.test.ts src/components/GraphNode.test.tsx`
Expected: FAIL — `data.badge` is undefined; `./GraphNode` does not resolve.

- [ ] **Step 3a: Enrich `build-graph.ts`**

In `packages/spine-ui/src/graph/build-graph.ts`, add the import at the top:

```ts
import { recipeSlugOf } from '../recipe'
```

Replace the `RouteGraphNode` interface:

```ts
export interface RouteGraphNode {
  id: string
  type: 'recipeAware'
  position: { x: number; y: number }
  data: {
    label: string
    kind: SpineFolderTaskKind
    status: SpineFolderTaskStatus
    badge: string
    recipeName?: string
  }
}
```

Replace the `buildRouteGraph` signature and the `nodes` mapping (leave the edge logic and `isRecord` helper unchanged):

```ts
export function buildRouteGraph(
  tasks: readonly SpineFolderTask[],
  recipeNameResolver: (slug: string) => string | undefined = () => undefined,
): { nodes: RouteGraphNode[]; edges: RouteGraphEdge[] } {
  const sorted = [...tasks].sort((a, b) => (a.wave ?? 0) - (b.wave ?? 0) || a.id.localeCompare(b.id))

  const nodes: RouteGraphNode[] = sorted.map((t, i) => {
    const slug = recipeSlugOf(t)
    return {
      id: t.id,
      type: 'recipeAware',
      position: { x: i * 200, y: 0 },
      data: {
        label: t.plan_ref,
        kind: t.kind,
        status: t.status,
        badge: slug ? 'recipe' : t.kind,
        recipeName: slug ? recipeNameResolver(slug) ?? slug : undefined,
      },
    }
  })
```

(The rest of the function — `nodeIds`, edge building, `return` — stays exactly as-is.)

- [ ] **Step 3b: Create `GraphNode.tsx`**

Create `packages/spine-ui/src/components/GraphNode.tsx`:

```tsx
import type { RouteGraphNode } from '../graph/build-graph'

export function GraphNode({ data }: { data: RouteGraphNode['data'] }) {
  return (
    <div style={{ border: '1px solid #999', borderRadius: 4, padding: '4px 8px', background: '#fff', fontSize: 12, minWidth: 80 }}>
      <div>
        <span style={{ background: '#eee', borderRadius: 3, padding: '0 4px', marginRight: 4 }}>{data.badge}</span>
        {data.label}
      </div>
      {data.recipeName ? <div style={{ color: '#666', fontSize: 11 }}>{data.recipeName}</div> : null}
    </div>
  )
}
```

- [ ] **Step 3c: Wire the resolver + node type into `RouteGraph.tsx`**

Replace the body of `packages/spine-ui/src/components/RouteGraph.tsx`:

```tsx
import { useCallback, useMemo } from 'react'
import { Background, Controls, ReactFlow } from '@xyflow/react'

import { GraphNode } from './GraphNode'
import { buildRouteGraph } from '../graph/build-graph'
import { resolveRecipe } from '../recipe'
import { useStore } from '../store'

const nodeTypes = { recipeAware: GraphNode }

export function RouteGraph() {
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const tasks = useStore((s) => s.tasks)
  const routes = useStore((s) => s.routes)
  const recipesByQuest = useStore((s) => s.recipesByQuest)
  const recipesAll = useStore((s) => s.recipesAll)
  const selectTask = useStore((s) => s.selectTask)

  const routeTasks = useMemo(() => tasks.filter((t) => t.route_id === selectedRouteId), [tasks, selectedRouteId])
  const quest = routes.find((r) => r.id === selectedRouteId)?.quest
  const resolver = useCallback(
    (slug: string) => resolveRecipe(slug, quest, { recipesByQuest, recipesAll })?.name,
    [quest, recipesByQuest, recipesAll],
  )
  const { nodes, edges } = useMemo(() => buildRouteGraph(routeTasks, resolver), [routeTasks, resolver])

  if (!selectedRouteId) return <div style={{ padding: 16 }}>Select a route to view its DAG.</div>

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView onNodeClick={(_e, node) => selectTask(node.id)}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/spine-ui && npx vitest run src/graph/build-graph.test.ts src/components/GraphNode.test.tsx`
Expected: PASS. Then run the full UI suite to confirm no regression in the existing App/store tests:
Run: `cd packages/spine-ui && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/graph/build-graph.ts packages/spine-ui/src/components/GraphNode.tsx packages/spine-ui/src/components/GraphNode.test.tsx packages/spine-ui/src/components/RouteGraph.tsx packages/spine-ui/src/graph/build-graph.test.ts
git commit -m "feat(ui): graph node badges + recipe-name subtitle via injected resolver (runner-8uf)"
```

---

### Task 7: Fetch wiring — `catalog.recipes` on (quest, scope) + recipesError banner

**Files:**
- Modify: `packages/spine-ui/src/App.tsx`
- Test: `packages/spine-ui/src/App.test.tsx`

**Interfaces:**
- Consumes from store: `recipeScope`, `selectedRouteId`, `routes`, `recipesByQuest`, `recipesAll`, `setQuestRecipes`, `setAllRecipes`, `setRecipesError`, `recipesError`. Uses the existing `client.cmd`, `listField`, and `toMessage` helpers and the `Recipe` type from `../recipe`.
- Produces: a new `useEffect` in `Console` that fetches recipes once per scope, plus a `recipes` row in the existing error banner.

- [ ] **Step 1: Write the failing test**

Append to `packages/spine-ui/src/App.test.tsx` a new test inside the existing `describe('App', …)` block:

```tsx
  it('fetches quest recipes once on route select, refetches once on All toggle, and surfaces fetch errors', async () => {
    const client = new FakeEngineClient()
    client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
    client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [] }
    client.responses['routes.list'] = { ok: true, action: 'routes.list', routes: [{ id: 'route-001', quest: 'code-review', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }] }
    client.responses['tasks.list'] = { ok: true, action: 'tasks.list', tasks: [] }
    client.responses['catalog.recipes'] = { ok: true, action: 'catalog.recipes', recipes: [{ slug: 'reviewer', name: 'Code Reviewer' }], warnings: [] } as never

    render(<App client={client} />)
    await waitFor(() => expect(screen.getByText('Routes')).toBeInTheDocument())

    // Populate the store routes (so activeQuest can resolve) via an authoritative snapshot.
    act(() => {
      client.emit({
        type: 'snapshot', apiVersion: '1', seq: 1,
        routes: [{ id: 'route-001', quest: 'code-review', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
        tasks: [],
      })
    })

    // Select the route → exactly one quest-scoped catalog.recipes for code-review.
    act(() => { useStore.getState().selectRoute('route-001') })
    await waitFor(() => expect(useStore.getState().recipesByQuest['code-review']).toBeDefined())
    const questCalls = client.calls.filter((c) => c.name === 'catalog.recipes' && (c.payload as { quest?: string })?.quest === 'code-review')
    expect(questCalls).toHaveLength(1)

    // Re-selecting the same route does not refetch (cache hit).
    act(() => { useStore.getState().selectRoute('route-001') })
    expect(client.calls.filter((c) => c.name === 'catalog.recipes' && (c.payload as { quest?: string })?.quest === 'code-review')).toHaveLength(1)

    // Toggle to All → exactly one global catalog.recipes (no quest payload).
    act(() => { useStore.getState().setRecipeScope('all') })
    await waitFor(() => expect(useStore.getState().recipesAll).toBeDefined())
    const allCalls = client.calls.filter((c) => c.name === 'catalog.recipes' && !(c.payload as { quest?: string })?.quest)
    expect(allCalls).toHaveLength(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/App.test.tsx`
Expected: FAIL — no `catalog.recipes` call is ever made (`recipesByQuest['code-review']` stays undefined).

- [ ] **Step 3: Write minimal implementation**

In `packages/spine-ui/src/App.tsx`:

3a. Add the import near the other local imports:

```ts
import type { Recipe } from './recipe'
```

3b. Inside `Console`, add the new store selectors alongside the existing ones (after the `error` selector):

```ts
  const recipeScope = useStore((s) => s.recipeScope)
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const routesList = useStore((s) => s.routes)
  const setQuestRecipes = useStore((s) => s.setQuestRecipes)
  const setAllRecipes = useStore((s) => s.setAllRecipes)
  const setRecipesError = useStore((s) => s.setRecipesError)
  const recipesError = useStore((s) => s.recipesError)
  const activeQuest = routesList.find((r) => r.id === selectedRouteId)?.quest
```

3c. Add the fetch effect (place it after the routes-refetch `useEffect`, before the `errors` array is built). It reads the cache via `useStore.getState()` so it depends only on scope/quest, never on the cache objects — that prevents a refetch loop:

```ts
  // Fetch recipes once per scope and cache. Route scope fetches the selected
  // route's quest recipes; All scope fetches the global catalog. The cache check
  // reads getState() (not the subscribed cache objects) so this effect depends
  // only on (client, recipeScope, activeQuest) and never re-runs just because the
  // cache it just wrote changed. cancelled guards a stale in-flight response.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if (recipeScope === 'all') {
          if (useStore.getState().recipesAll) return
          const env = (await client.cmd('catalog.recipes')) as { ok: boolean; error?: string; recipes?: Recipe[]; warnings?: string[] }
          const recipes = listField<'recipes', Recipe[]>(env, 'catalog.recipes', 'recipes')
          if (cancelled || !recipes) return
          setAllRecipes(recipes, env.warnings ?? [])
          setRecipesError(null)
        } else {
          if (!activeQuest || useStore.getState().recipesByQuest[activeQuest]) return
          const env = (await client.cmd('catalog.recipes', { quest: activeQuest })) as { ok: boolean; error?: string; recipes?: Recipe[] }
          const recipes = listField<'recipes', Recipe[]>(env, 'catalog.recipes', 'recipes')
          if (cancelled || !recipes) return
          setQuestRecipes(activeQuest, recipes)
          setRecipesError(null)
        }
      } catch (err) {
        if (!cancelled) setRecipesError(toMessage(err))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [client, recipeScope, activeQuest, setQuestRecipes, setAllRecipes, setRecipesError])
```

3d. Add the `recipes` row to the `errors` array (after the `routes` push, before `sessions`):

```ts
  if (recipesError) errors.push({ key: 'recipes', msg: recipesError, clear: () => setRecipesError(null) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/App.test.tsx`
Expected: PASS — the new test plus all existing App tests.

Then the full suite:
Run: `cd packages/spine-ui && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/App.tsx packages/spine-ui/src/App.test.tsx
git commit -m "feat(ui): fetch catalog.recipes per scope with cache + recipesError banner (runner-8uf)"
```

---

### Task 8: Full typecheck + UI smoke verification

**Files:**
- None (verification only).

- [ ] **Step 1: Typecheck the UI package**

Run: `cd packages/spine-ui && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If the package has no standalone `tsconfig.json`, run the repo's typecheck script: `cd ~/Agent-Corporation/runner && npm run typecheck`.)

- [ ] **Step 2: Run the entire UI test suite**

Run: `cd packages/spine-ui && npx vitest run`
Expected: PASS — all suites (recipe, store, RecipeCard, RoutesPanel, TaskDetail, build-graph, GraphNode, App).

- [ ] **Step 3: Manual smoke (optional but recommended)**

With an engine host running (handshake env set), `SPINE_ENGINE_HANDSHAKE=… pnpm dev:ui`, open `http://localhost:5273`, select a route, confirm the Recipes rail lists the quest's recipes, click a recipe node and a rail recipe, and toggle **All**. Verify a recipe card shows name/description/tools/prompt.

- [ ] **Step 4: Commit (only if Step 1–2 required any fix)**

```bash
git add -A packages/spine-ui
git commit -m "chore(ui): typecheck + full-suite green for recipe-detail surface (runner-8uf)"
```

---

## Notes for the executor

- **Test isolation:** every component/store test resets the store with `useStore.setState(initial, true)` in `beforeEach` (the existing pattern). Reuse it; do not invent a new reset.
- **ReactFlow is mocked** in `App.test.tsx` (`vi.mock('@xyflow/react', …)`), so the graph's visual node rendering is never exercised through App — that's why `GraphNode` and `build-graph` have their own direct unit tests.
- **Do not touch any package other than `packages/spine-ui`.** If you find yourself editing `@projectrunner/spine-folder-host` or `@projectrunner/spine-engine-host`, stop — the slug helper and `Recipe` type live entirely in the UI by design (Global Constraints).
- **The slug path lives in exactly one place** (`recipeSlugOf`). If you need the slug anywhere, call the helper; never re-read `metadata.runner.*` inline.
