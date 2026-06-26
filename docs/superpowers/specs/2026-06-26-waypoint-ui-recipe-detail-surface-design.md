# Waypoint UI — Recipe-Detail Surface Design

**Date:** 2026-06-26
**Status:** Final — MAR-converged on the `claude-1` base (10 evaluation rounds, majority resolver), plus two post-review corrections folded in (see **Post-MAR corrections**).
**Tracking:** waypoint-8uf
**Package:** `packages/waypoint-ui`
**MAR run:** `runs/20260626-gLHLaI` (integrated artifact `038-claude-1-integration.md`; decision record `decision-record.md`)

## Problem

The console renders routes and their DAG, but a route is a deliberately thin
runtime record. The substance an operator actually wants — *what instructions
the agent runs at each step* — lives one hop away in the **recipes**: the
`prompt`, `tools`, `description`, and `name` of each recipe a quest references.
Today the UI never makes that hop. `buildRouteGraph` paints node labels from
`task.plan_ref` only (`graph/build-graph.ts:21`), and `TaskDetail` surfaces
raw task fields; the recipe slug is never resolved to its manifest. The operator
sees boxes, not the work.

The recipe slug a task carries is **backend-specific** (verified against source —
see **Post-MAR corrections**, G1): the folder-host backend writes it nested at
`metadata.waypoint.recipe.slug`, while the Beads backend writes it flat at
`metadata.waypoint.recipe_slug` (`beads/compiler.ts:291`). The UI must read both.

## Goal

Surface recipes as first-class, readable content in the console:

1. Selecting a **recipe node** in the DAG shows that recipe's card — name,
   description, tools, full prompt — in the center detail pane.
2. A left-rail **Recipes** section lets the operator browse recipes directly,
   scoped to the selected route's quest by default, with an **All** toggle for
   the whole workspace catalog.
3. Graph nodes carry a **kind badge** and, for recipe nodes, the recipe **name**
   as a subtitle, so the DAG's shape is legible before clicking.

## Non-Goals

- No engine, proxy, or catalog changes. The feature is entirely UI-side.
- No new runtime dependencies.
- No editing or execution of recipes from the UI (read-only, consistent with
  the console's observability-only posture).
- No display of recipe *source file paths*. `catalog.recipes` returns
  `CatalogRecipeManifest` objects, which carry no path; we do not add a lookup.
- No interactive recipe surface beyond selection/scope: no Search/Filter box, no
  Copy-Prompt action, no `unknown`-typed "Advanced" metadata/runtime dump. These
  are captured under **Deferred follow-ups** and are explicitly out of scope for
  this read-only slice.

## Architecture

A pure UI feature built on one already-reachable engine command.

### The command: `catalog.recipes`

`registerCatalogCommands` exposes `catalog.recipes`
(`engine-host/src/core/commands/catalog.ts:18`), and the Vite dev proxy forwards
every `/cmd/*` request with no per-command allow-list
(`waypoint-ui/vite.config.ts`), so the browser client can call it today with no
server change. Two call shapes, both returning manifests that include the full
prompt:

- **Route-scoped:** `catalog.recipes({ quest })` → `{ quest, recipes, warnings: [] }`.
  Resolution-only — the recipe winners *that quest references*. Per the command
  source, `warnings` is **always `[]`** in this branch (a malformed file the
  quest references fails loud as `NOT_FOUND` instead). Throws an `EngineError`
  envelope with `code: "NOT_FOUND"`, `field: "quest"` for an unknown quest slug.
- **Global:** `catalog.recipes()` (no payload) → `{ recipes, warnings }`, where
  `warnings` is the skip-and-warn list of malformed authored recipe files.

The wire manifest is `CatalogRecipeManifest`
(`folder-host/src/catalog/bundled.ts:19`):

```ts
interface CatalogRecipeManifest {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly runtime?: unknown
  readonly tools?: readonly string[]
  readonly metadata?: unknown
}
```

The UI only renders `slug`, `name`, `description`, `prompt`, `tools`; `Recipe`
(the UI alias) is `Pick<CatalogRecipeManifest, 'slug' | 'name' | 'description' | 'prompt' | 'tools'>`,
re-exported through `engine/types.ts` alongside the existing folder-host
re-exports. The warnings type — `CatalogRecipeWarning` (the element type of the
global call's `warnings` array) — is re-exported through the same `engine/types.ts`
barrel so the store can type the All-scope warnings field below.
**`prompt` and `tools` are optional** — the lenient catalog parser
permits a recipe with neither — so the card must handle their absence.

### Data flow & caching

Recipes are static catalog data (they do not change over a session the way
routes and tasks do), so the UI **fetches once per scope and caches**:

- `recipesByQuest: Record<questSlug, Recipe[]>` — populated lazily when a route
  whose quest is not yet cached is selected.
- `recipesAll: Recipe[] | null` — populated once when the rail is first flipped
  to **All**.

No new polling, epoch, or WS subscription. A single `useEffect` in `App`/`Console`
reacts to `(selectedQuest, recipeScope)` and issues at most one fetch when the
needed list is missing from cache. In-flight fetches are guarded with a
`cancelled` flag — the same pattern the routes/sessions effects already use in
`App.tsx` — so a stale response cannot overwrite a newer one.

**Keying note:** the quest cache keys on the **selected route's quest slug**,
not the route id. Two routes of the same quest share one cache entry and the
second route selection does not refetch. The effect dependency is therefore the
*derived quest slug*, not `selectedRouteId`.

### Selection model

A new store field `selectedRecipeSlug: string | null` drives the center pane. A
node is treated as a **recipe node** when it carries a non-empty recipe slug, as
returned by the single shared helper:

```ts
// The one place the backend-specific slug path is encoded. Folder-host writes
// the slug nested at metadata.waypoint.recipe.slug; the Beads backend writes it
// flat at metadata.waypoint.recipe_slug (beads/compiler.ts:291). Both are read
// here so every consumer — selectTask, the badge, the graph subtitle — agrees.
function recipeSlugOf(task: Task): string | null {
  const wp = (task.metadata as { waypoint?: { recipe?: { slug?: string }; recipe_slug?: string } } | undefined)?.waypoint
  const slug = wp?.recipe?.slug ?? wp?.recipe_slug
  return slug && slug.length > 0 ? slug : null
}
```

Recipe-ness is decided **solely** by `recipeSlugOf(task) !== null` — the same
non-empty-slug condition the folder-host uses to derive `kind: 'recipe'`
(`tasks/store.ts:117-122`) — rather than testing the rendered badge string or a
`node.type` field. This matters because `kind` is a **12-value union**
(`recipe | discussion | gate | checkpoint | wait | handoff | artifact | node | delay | timer | dependency | system`,
confirmed in `packages/waypoint-folder-host/src/tasks/types.ts`),
so "not a recipe" is *eleven* other kinds, not just `checkpoint`. The badge
derivation never enumerates kinds — recipe-ness is the non-empty slug, and every
non-recipe node badges its verbatim `kind` value — so the exhaustiveness of
"not a recipe" holds independent of the count.

| User action | `selectedTaskId` | `selectedRecipeSlug` |
| --- | --- | --- |
| Click a node with a recipe slug | the task id | `recipeSlugOf(task)` |
| Click any node **without** a recipe slug | the task id | `null` (cleared) |
| Click a **rail recipe** | unchanged | the rail recipe's slug |
| Select a **different route** (`selectRoute`) | `null` (cleared) | `null` (cleared) |

`selectRoute(routeId)` clears **both** `selectedTaskId` and `selectedRecipeSlug`,
resetting the detail view for the new route context (extending today's behavior,
which clears only `selectedTaskId`). This prevents a recipe card from a prior
route lingering in the center pane after a route switch.

Center-pane render priority:

1. `selectedRecipeSlug` set → render `RecipeCard` for that slug. If the selection
   also came from a task, show compact task fields **above** the card.
2. else `selectedTaskId` set → today's task fields.
3. else → placeholder ("Select a node or recipe.").

A slug resolves through `resolveRecipe(state, slug)`: search the active route's
quest cache first, then the global cache. A slug present in neither *loaded*
scope renders the not-found fallback rather than throwing.

## Components

### `RecipeCard.tsx` (new)

Renders one recipe manifest. Props: `{ recipe: Recipe | undefined; slug: string }`.

- `recipe` defined → header `name` (fallback to `slug` when name is empty); a
  muted `slug` line; `description` (or "No description"); `tools` as inline chips
  (or "No tool grants"); and `prompt` inside a collapsed `<details>`
  (`white-space: pre-wrap`, monospace, `max-height: ~50vh; overflow: auto` so a
  long prompt does not blow out the pane). A recipe with no `prompt` shows
  "No prompt defined."
- `recipe` undefined → "Recipe `<slug>` not found in the loaded catalog."

The card touches no store and fetches nothing — a pure render of its props,
unit-testable in isolation.

### `RoutesPanel.tsx` (modify)

Add a **Recipes** section beneath the existing Routes list:

- A header with a two-state toggle `Route | All`, bound to `recipeScope`.
  Switching to **All** triggers the global fetch (via the Console effect) when
  `recipesAll` is null.
- The list shows recipe `name`s for the active scope (route scope reads
  `recipesByQuest[selectedRoute.quest]`; all scope reads `recipesAll`). Each row
  calls `selectRecipe(slug)`; the row matching `selectedRecipeSlug` is
  highlighted.
- The header shows a muted note when the active scope's fetch returned warnings:
  `⚠ N unreadable`, where `N` is `recipesWarningsAll.length` (non-blocking;
  readable recipes still list). Because the route-scoped branch always returns
  `warnings: []`, this note can only appear in **All** scope — the store field
  backing it is All-scope-only by construction (see State summary).
- Empty states: route scope, zero recipes → "No recipes for this quest.";
  All scope before load resolves → "Loading catalog…"; no route selected in
  route scope → "Select a route to see its recipes."

### `TaskDetail.tsx` (modify) — the detail dispatcher

`TaskDetail` becomes the dispatcher from the selection model: it reads
`selectedRecipeSlug`, resolves the manifest via `resolveRecipe`, and renders
`RecipeCard` (optionally above task fields). With no recipe selected it renders
exactly today's task fields. `resolveRecipe(state, slug)` is a small pure helper,
unit-testable.

### `RouteGraph.tsx` + `graph/build-graph.ts` (modify)

`buildRouteGraph` already maps tasks to nodes/edges and threads `kind` into
`node.data`. Extend each node's `data` with:

- `badge`: `'recipe'` when `recipeSlugOf(task) !== null`, else the verbatim
  `kind` value (badged generically). This keeps the badge honest for all 12 kinds
  rather than collapsing them to recipe/checkpoint.
- `recipeName`: for recipe nodes, looked up from a `slug → name` resolver,
  falling back to the slug, falling back to `undefined` when caches are not yet
  loaded. The node renders `plan_ref` with the badge and, when present, the
  recipe name on a subtitle line.

`buildRouteGraph` is currently a pure `(tasks) => {nodes, edges}` function. Its
signature becomes:

```ts
buildRouteGraph(
  tasks: Task[],
  recipeNameResolver: (slug: string) => string | undefined = () => undefined,
): { nodes; edges }
```

The `recipeNameResolver` is **injected** — `RouteGraph` passes a function that
reads from the recipe caches, so the builder stays pure (it never reads the
store or React state itself) and remains testable in isolation. The parameter is
**optional and defaulted** to `() => undefined`, so every existing
single-argument call site and test compiles unchanged and renders the slug-only
fallback. The builder derives the slug via the shared `recipeSlugOf` helper, so
its badge and the selection model cannot disagree about which nodes are recipes.

## Error handling

Reuse the per-source error pattern in `App.tsx`. Add a `recipesError: string | null`
source distinct from `routesError`/`sessionsError`/`error`:

- A throwing `catalog.recipes` (e.g. `NOT_FOUND` for an unknown quest, or a
  transport failure) sets `recipesError` through the same `listField`
  throw-on-non-ok helper (`App.tsx:21`) used for `routes.list`. The banner offers
  **Dismiss**.
- `warnings` from a *successful* fetch are **not** errors — they are persisted in
  `recipesWarningsAll` (All-scope only) and render as the muted rail-header note,
  never the banner.
- A failed fetch leaves any previously cached list intact (the cache is written
  only on success), so an error never blanks an already-loaded rail.

## State summary (`store.ts`)

New state:

```ts
selectedRecipeSlug: string | null                 // null
recipeScope: 'route' | 'all'                      // 'route'
recipesByQuest: Record<string, Recipe[]>          // {}
recipesAll: Recipe[] | null                       // null
recipesWarningsAll: CatalogRecipeWarning[] | null // null
recipesError: string | null                       // null
```

`recipesWarningsAll` is written **only** by the global `setAllRecipes` path,
alongside `recipesAll`. There is deliberately **no** per-quest warnings field:
the route-scoped `catalog.recipes({ quest })` branch always returns
`warnings: []` (a malformed referenced file fails loud as `NOT_FOUND` instead),
so quest-scope warnings can never be non-empty. One All-scope field is both
necessary and sufficient, and it makes the store actually hold the data the
rail-header note renders.

New actions:

```ts
selectRecipe(slug: string | null): void
setRecipeScope(scope: 'route' | 'all'): void
setQuestRecipes(quest: string, recipes: Recipe[]): void
setAllRecipes(recipes: Recipe[], warnings: CatalogRecipeWarning[]): void
setRecipesError(e: string | null): void
```

`setAllRecipes` writes `recipesAll` and `recipesWarningsAll` together (the only
writer of the warnings field). `selectTask` is extended so selecting a task sets
`selectedRecipeSlug` to `recipeSlugOf(task)` (which covers both backend paths)
and clears it when that returns null — preserving the existing single-arg
signature and all current callers. `selectRoute` is extended to clear **both**
`selectedTaskId` and `selectedRecipeSlug` (today it clears only the task),
resetting the detail view for the new route. (`recipeSlugOf` is the single shared
pure helper both `selectTask` and `buildRouteGraph` read the slug through.)

## Testing

Vitest + Testing Library, matching existing `store.test.ts` / `App.test.tsx`.

- **store:** `selectRecipe` sets/clears the slug; `setRecipeScope` flips scope;
  cache setters populate `recipesByQuest` / `recipesAll`; `setAllRecipes` also
  populates `recipesWarningsAll`; `selectTask` on a task with a recipe slug sets
  `selectedRecipeSlug`, and on any non-recipe task (test at least `checkpoint`
  and one other kind, e.g. `gate`) clears it; `selectRoute` clears both
  `selectedTaskId` and `selectedRecipeSlug`; `resolveRecipe` prefers the quest
  cache, then global, then returns undefined.
- **`recipeSlugOf` helper:** resolves the **nested** folder-host path
  (`metadata.waypoint.recipe.slug`) *and* the **flat** Beads path
  (`metadata.waypoint.recipe_slug`); returns null for an empty-string slug, a
  missing `waypoint` block, and a task whose metadata is a JSON string rather
  than an object. (Both backend shapes are covered so a Beads-backed route
  resolves recipes — the G1 correction.)
- **RecipeCard:** renders name/slug/description/tools/prompt; tools-less and
  prompt-less fallbacks; name-empty → slug header; not-found fallback when
  `recipe` is undefined.
- **RoutesPanel:** lists names for the active scope; the toggle switches scope;
  selecting a row highlights it and sets the slug; the `⚠ N unreadable` note
  reads `recipesWarningsAll.length` and appears only with warnings (All scope);
  each empty/no-route state renders.
- **build-graph:** a task with a recipe slug (via either backend path) gets the
  `recipe` badge and the resolved name subtitle (resolver supplied); a
  `checkpoint` task gets the `checkpoint` badge; an unresolved slug (resolver
  returns undefined) falls back to the slug text; the existing no-resolver
  (default-argument) call sites still produce the same nodes/edges.
- **App integration (engine client mocked, as in existing App tests):** selecting
  a route triggers exactly one `catalog.recipes({quest})` and caches it; a second
  selection of a route with the *same quest* does not refetch; clicking a recipe
  node renders the card; flipping the rail to **All** triggers exactly one global
  `catalog.recipes()` and persists its warnings; a thrown fetch raises the
  `recipesError` banner without blanking a previously loaded list.

## Risks & mitigations

- **Large global payload.** The full catalog includes every prompt (firmvault
  alone is 57 recipes with long prompts). Mitigation: the global list is fetched
  only on explicit **All** toggle, only once; prompts render lazily inside a
  collapsed `<details>`, so the DOM cost of unexpanded prompts is text-node only.
  A follow-up can switch **All** to a names-only list with per-selection detail —
  out of scope here.
- **Cache staleness.** Recipes are treated as static for the session. If an
  authored recipe changes on disk mid-session the UI will not reflect it until
  reload. Accepted; the console is observability-only and recipe authoring is not
  a UI flow.
- **Slug→name on the graph before recipes load.** The graph may render before the
  quest's recipes are cached, so the subtitle falls back to the slug, then
  upgrades to the name on the next render once the cache populates. Purely
  progressive enhancement; no error state.
- **Recipe-ness is derived from the slug, not stored.** A node's recipe-ness is
  inferred solely from a non-empty recipe slug via the shared `recipeSlugOf`
  helper — never from a `node.type` field or the rendered badge. The helper reads
  both backend slug paths, so the badge, the selection model, and the graph
  subtitle cannot disagree, and a Beads-backed route resolves identically to a
  folder-host one.

## Resolved decisions

These forks were settled during MAR convergence (`shared/resolved-decisions.md`)
and are CLOSED — do not relitigate them:

1. **All-scope warnings field.** A single `recipesWarningsAll: CatalogRecipeWarning[] | null`
   field (default null), written only on the global-fetch success path; the
   rail-header note reads its length. No per-quest warnings field, because
   route-scope warnings are structurally always `[]`.
2. **Selection clearing rules.** `selectTask` derives/clears `selectedRecipeSlug`
   from the task's recipe slug; `selectRoute` clears both `selectedTaskId` and
   `selectedRecipeSlug`. Implemented as extensions of the existing actions (not a
   new `selectNode` action), preserving all current callers.
3. **Pure graph builder.** `buildRouteGraph(tasks, recipeNameResolver)` stays
   pure via the injected resolver; it never reads the store/cache directly.
4. **Payload-risk wording.** Quantified with the concrete spec example
   ("firmvault alone is 57 recipes with long prompts"), not an asserted byte
   figure.
5. **Task-kind count.** `WaypointFolderTaskKind` is a **12-value** union; "not a
   recipe" is eleven other kinds.

## Post-MAR corrections

Two corrections applied after the converged integration, recorded here for
provenance (they were **not** settled by the run's convergence):

- **G1 — backend-specific recipe-slug path (verified against source).** The
  three-vendor run resolved the slug at `metadata.waypoint.recipe.slug` only. The
  Beads backend writes the slug flat at `metadata.waypoint.recipe_slug`
  (`beads/compiler.ts:291`), so a slug-only-nested UI would silently fail to
  resolve recipes for Beads-backed routes. Corrected by routing every slug read
  through the shared `recipeSlugOf` helper, which reads both paths. (This finding
  was raised by the earlier two-agent run's reviewer and confirmed against source
  before folding in.)
- **Slug-vs-`node.type` consistency.** The integrated draft's risk section said
  recipe-ness could be inferred from "an explicit `waypoint.node.type` override,"
  contradicting the selection model's slug-only rule (codex-1 validation, issue 2,
  non-blocking). Resolved in favor of the selection model: recipe-ness is the
  non-empty slug, full stop; the `node.type` mention is removed.

## Deferred follow-ups (out of scope for this slice)

- **Copy Prompt** affordance on `RecipeCard` — a net-new interactive control on
  an explicitly read-only slice. The prompt is already fully selectable inside
  its `<details>` container, so operators can copy it manually today. Deferred.
- **Search / Filter** of the recipe rail — an interactive filter surface absent
  from the spec's goals and non-goals. Deferred.
- **Advanced metadata/runtime view** — rendering the `unknown`-typed `metadata`
  and `runtime` manifest fields would re-create the raw-JSON-dump anti-pattern
  this feature exists to replace. Excluded.
- **Names-only All-scope list** with per-selection detail fetch, as a payload
  optimization if the eager full-catalog fetch proves heavy.
