# Waypoint UI — Recipe-Detail Surface Design

**Date:** 2026-06-26
**Status:** Draft (pending MAR review)
**Tracking:** waypoint-8uf
**Package:** `packages/waypoint-ui`

## Problem

The console renders routes and their DAG, but a route is intentionally a thin
runtime record. The substance an operator wants — *what instructions does the
agent actually run at each step* — lives one hop away in the **recipes**: the
`prompt`, `tools`, and `description` of each recipe a quest references. Today the
UI never makes that hop. `RouteGraph` paints only `plan_ref` labels, and
`TaskDetail` dumps `task.metadata` as a raw JSON blob in which the recipe slug
sits unresolved. The operator sees boxes, not the work.

## Goal

Surface recipes as first-class, readable content in the console:

1. Selecting a **recipe node** in the DAG shows that recipe's card — name,
   description, tools, and full prompt — in the center detail pane.
2. A left-rail **Recipes** section lets the operator browse recipes directly,
   scoped to the selected route's quest by default with an **All** toggle for the
   whole workspace catalog.
3. Graph nodes carry a **type badge** (recipe vs checkpoint) and, for recipe
   nodes, the recipe **name** as a subtitle, so the DAG's shape is legible before
   clicking.

## Non-Goals

- No engine, proxy, or catalog changes. The feature is entirely UI-side.
- No new runtime dependencies.
- No editing of recipes from the UI (read-only surface, consistent with the
  console's observability-only posture).
- No recipe execution controls (the console does not start work).
- No display of recipe *source file paths* — `catalog.recipes` returns
  manifests (`slug/name/description/tools/prompt`), not file locations, and we do
  not add a path lookup.

## Architecture

Pure UI feature built on one already-reachable engine command.

### The command: `catalog.recipes`

`registerCatalogCommands` exposes `catalog.recipes`, and the Vite dev proxy
forwards every `/cmd/*` (no per-command allow-list), so the browser client can
call it today with no server change.

Two call shapes, both returning manifests that include the full prompt:

- **Route-scoped:** `catalog.recipes({ quest })` → `{ quest, recipes, warnings: [] }`.
  Resolution-only: the recipe winners *that quest references*. Throws an envelope
  with `code: 'NOT_FOUND'` if the quest slug is unknown.
- **Global:** `catalog.recipes()` (no payload) → `{ recipes, warnings }` where
  `warnings` is the skip-and-warn list of malformed authored recipe files.

Each entry is a `CatalogRecipeManifest`:

```ts
interface CatalogRecipeManifest {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly tools?: readonly string[]
}
```

`prompt` and `tools` are optional — the lenient catalog parser permits a recipe
with neither, so the card must handle their absence.

### Data flow & caching

Recipes are static catalog data (they do not change over a session the way routes
and tasks do), so the UI **fetches once per scope and caches**:

- `recipesByQuest: Record<questSlug, Recipe[]>` — populated lazily when a route
  whose quest is not yet cached is selected.
- `recipesAll: Recipe[] | null` — populated once when the rail is first flipped to
  **All**.

No new polling, no epoch, no WS subscription. A single `useEffect` in `Console`
reacts to `(selectedRouteId, recipeScope)` and issues at most one fetch when the
needed list is missing from the cache. In-flight fetches are guarded with a
`cancelled` flag (the established pattern in `App.tsx`) so a stale response cannot
overwrite a newer one.

### Selection model

A new store field `selectedRecipeSlug: string | null` drives the center pane, set
from three entry points:

| User action | `selectedTaskId` | `selectedRecipeSlug` |
| --- | --- | --- |
| Click a **recipe node** | the task id | `metadata.waypoint.recipe.slug` |
| Click a **checkpoint node** | the task id | `null` (cleared) |
| Click a **rail recipe** | unchanged | the rail recipe's slug |

Center-pane render priority:

1. `selectedRecipeSlug` set → render `RecipeCard` for that slug. If the selection
   also came from a task (recipe node), show compact task fields **above** the
   card.
2. else `selectedTaskId` set → today's task fields.
3. else → placeholder ("Select a node or recipe.").

Resolution of a slug to a manifest searches the route-quest cache first, then the
global cache; a slug present in neither (within the loaded scopes) renders the
not-found fallback rather than throwing.

## Components

### `RecipeCard.tsx` (new)

Renders one recipe manifest. Props: `{ recipe: Recipe | undefined; slug: string }`.

- `recipe` defined → header `name` (fallback to `slug` if name is empty), a muted
  `slug` line, `description` (or "No description"), `tools` rendered as inline
  chips (or "No tool grants"), and `prompt` inside a collapsed `<details>`
  (`white-space: pre-wrap`, monospace, a scroll cap of ~50vh so a long prompt does
  not blow out the pane). A recipe with no `prompt` shows "No prompt defined."
- `recipe` undefined → "Recipe `<slug>` not found in the loaded catalog."

The card touches no store and fetches nothing — it is a pure render of its props,
unit-testable in isolation.

### `RoutesPanel.tsx` (modify)

Add a **Recipes** section beneath the existing Routes list:

- A section header with a two-state toggle: `Route | All`, bound to
  `recipeScope`. Switching to **All** triggers the global fetch (via the Console
  effect) if `recipesAll` is null.
- The list shows recipe `name`s for the active scope (route scope reads
  `recipesByQuest[selectedRoute.quest]`; all scope reads `recipesAll`). Each row
  calls `selectRecipe(slug)`; the row matching `selectedRecipeSlug` is
  highlighted.
- Header shows a muted warning note when the active scope's fetch returned
  warnings: `⚠ N unreadable` (non-blocking; the readable recipes still list).
- Empty states: route scope with zero recipes → "No recipes for this quest.";
  all scope before load resolves → "Loading catalog…"; no route selected in route
  scope → "Select a route to see its recipes."

### Center detail (modify `TaskDetail.tsx`)

`TaskDetail` becomes the detail dispatcher described in the selection model: it
reads `selectedRecipeSlug`, resolves the manifest from the caches, and renders
`RecipeCard` (optionally above task fields). When no recipe is selected it renders
exactly today's task fields. The recipe-resolution lookup is a small pure helper
(`resolveRecipe(state, slug)`), unit-testable.

### `RouteGraph.tsx` + `graph/build-graph.ts` (modify)

`build-graph` already maps tasks to nodes/edges. Extend each node's data with:

- `badge`: `'recipe'` or `'checkpoint'` (and any other `kind` value passed
  through verbatim, badged generically) derived from `task.kind`.
- `recipeName`: for recipe nodes, looked up from the recipe caches by
  `metadata.waypoint.recipe.slug`, falling back to the slug, falling back to
  undefined when caches are not yet loaded. The node label renders
  `plan_ref` with the badge prefix and the recipe name as a subtitle line.

Because `build-graph` is currently a pure `(tasks) => {nodes, edges}` function,
it gains a second argument — a `slug → name` resolver (or the recipe cache) — kept
pure so its existing tests extend cleanly.

## Error handling

Reuse the per-source error-banner pattern in `App.tsx` (`errors[]` with
`key/msg/clear`). Add a `recipesError: string | null` source:

- A throwing `catalog.recipes` (e.g. `NOT_FOUND` for an unknown quest, or a
  transport failure) sets `recipesError` via the same `listField` throw-on-non-ok
  helper used for `routes.list`. The banner row offers **Dismiss**.
- `warnings` from a successful fetch are **not** errors — they render as the muted
  rail-header note, never the banner.
- A failed recipe fetch leaves any previously cached list intact (we only write
  the cache on success), so an error never blanks an already-loaded rail.

## State summary (`store.ts`)

New state:

```ts
selectedRecipeSlug: string | null      // null
recipeScope: 'route' | 'all'           // 'route'
recipesByQuest: Record<string, Recipe[]> // {}
recipesAll: Recipe[] | null            // null
recipesError: string | null            // null
```

New actions:

```ts
selectRecipe(slug: string | null): void          // sets selectedRecipeSlug
setRecipeScope(scope: 'route' | 'all'): void
setQuestRecipes(quest: string, recipes: Recipe[]): void
setAllRecipes(recipes: Recipe[]): void
setRecipesError(e: string | null): void
```

`selectTask` is extended so selecting a recipe-kind task also sets
`selectedRecipeSlug`, and selecting a non-recipe task clears it. (Equivalently a
dedicated `selectNode(task)` action; the implementation plan picks one and keeps
`selectTask`'s existing single-arg callers working.)

`Recipe` is the UI alias for `CatalogRecipeManifest`, re-exported through
`engine/types.ts` alongside the existing folder-host type re-exports.

## Testing

Vitest + Testing Library, matching existing `store.test.ts` / `App.test.tsx`
patterns.

- **store:** `selectRecipe` sets/clears the slug; `setRecipeScope` flips scope;
  cache setters populate `recipesByQuest` / `recipesAll`; selecting a recipe-kind
  task sets `selectedRecipeSlug` from metadata while a checkpoint task clears it;
  `resolveRecipe` prefers the quest cache then the global cache then returns
  undefined.
- **RecipeCard:** renders name/slug/description/tools/prompt; tools-less and
  prompt-less fallbacks; not-found fallback when `recipe` is undefined.
- **RoutesPanel:** Recipes section lists names for the active scope; the toggle
  switches scope; selecting a row highlights it and sets the slug; the warning
  note appears when warnings are present; empty/no-route states render.
- **build-graph:** a recipe node gets the `recipe` badge and the resolved name
  subtitle; a checkpoint node gets the `checkpoint` badge; an unresolved slug
  falls back to the slug text.
- **App integration:** selecting a route triggers exactly one
  `catalog.recipes({quest})` and caches it (a second selection of the same route
  does not refetch); clicking a recipe node renders the card; flipping the rail to
  **All** triggers exactly one global `catalog.recipes()`; a thrown fetch raises
  the `recipesError` banner without blanking a previously loaded list. The engine
  client is mocked (as in the existing App tests).

## Risks & mitigations

- **Large global payload.** The full catalog includes every prompt (firmvault
  alone is 57 recipes with long prompts). Mitigation: the global list is fetched
  only on explicit **All** toggle and only once; the prompt renders lazily inside
  a collapsed `<details>`, so the DOM cost of unexpanded prompts is text-node
  only. If this proves heavy in practice, a follow-up can switch **All** to a
  names-only list with per-selection detail — out of scope here.
- **Cache staleness.** Recipes are treated as static for the session. If an
  authored recipe changes on disk mid-session the UI will not reflect it until
  reload. Accepted; the console is an observability surface and recipe authoring
  is not a UI flow.
- **Slug→name on the graph before recipes load.** The graph may render before the
  quest's recipes are cached, so the subtitle falls back to the slug, then
  upgrades to the name on the next render once the cache populates. No error
  state; purely progressive enhancement.
