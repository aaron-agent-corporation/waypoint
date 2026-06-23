# Waypoint — Workspace-Local Catalog Resolution (waypoint-j3b)

**Date:** 2026-06-23
**Issue:** waypoint-j3b — Engine Host follow-up: runtime resolution of workspace-authored catalog entries
**Status:** Design approved; ready for implementation plan

## Problem

The agent-authoring flow (slice 2) lets a human approve a proposal via
`author.approveProposal`, which lands the manifest into the workspace catalog:

- approved quests → `.waypoint/quests/<slug>.yaml`
- approved recipes → `.waypoint/recipes/<slug>.yaml`

(`installQuestCatalog` writes bundled quests/recipes into the same `.waypoint/`
dirs.)

But the runtime resolves quests and recipes only from the **bundled package
catalog** (`loadBundledWaypointCatalog()`), so an authored/approved quest is not
runnable or listable:

- `startQuestRoute` (`routes/start.ts:44-48`) calls
  `loadBundledWaypointCatalog().resolveQuestRecipes(quest)` and **throws** when
  the slug isn't in the bundle — even though it later reads the local quest
  manifest via `readLocalQuestManifest` (`:60`, `:135`).
- The beads path instantiates from the bundled catalog
  (`instantiateWaypointRouteInBeads(catalog, …)`, `:75`).
- `catalog.quests` / `catalog.recipes` list/resolve from the bundle only.

**Net effect:** approved proposals land on disk but are not reachable via
`run.start` / `resolveQuestRecipes` / `catalog.*`.

### Narrowing finding (verified during design)

A quest's `workflow` field is **only ever carried as a metadata string**, never
read as a file at route-start time. `startQuestRoute` and `startAdhocRoute` both
only require `workflow` to be a non-empty string (which the manifest provides)
and store it in route metadata (`routeMetadata` → `waypoint.workflow`). So the
real gap is **workspace-aware recipe/quest resolution**, not workflow-file
loading. (Implementation will re-confirm `runWaypointAutopilot` does not read the
`workflow` file; if it does, that becomes an explicit sub-task.)

## Decisions

1. **Resolution model: overlay, workspace-wins.** Merge bundled + workspace into
   one catalog; on a slug collision the **workspace** entry overrides the bundled
   one. Authored-only entries resolve; a workspace copy can intentionally
   customize a bundled quest/recipe; an authored quest may reference a mix of
   authored and bundled recipes.
2. **Scope: all resolution consumers.** Route every resolution site through the
   new loader so authored quests are both **runnable** (`run.start`, folder +
   beads) and **discoverable** (`catalog.quests` / `catalog.recipes`).

## Architecture

Add one primitive in `packages/waypoint-folder-host/src/catalog/`:

```ts
loadWorkspaceWaypointCatalog(projectRoot: string): Promise<BundledWaypointCatalog>
```

It returns the **same `BundledWaypointCatalog` interface** as
`loadBundledWaypointCatalog`, making it a **drop-in replacement** at every
resolution site. Internally it:

1. loads the bundled package catalog (existing `loadBundledWaypointCatalog()`);
2. loads workspace entries from `.waypoint/quests` + `.waypoint/recipes`
   (tolerant of either dir being absent);
3. merges bundled + workspace entries into unified quest/recipe registries with
   **workspace-wins on slug collision**;
4. exposes `resolveQuestRecipes` over the merged registries.

`loadBundledWaypointCatalog` is unchanged — it remains the bundled primitive the
new loader composes. The merge reuses the existing manifest parsers and
`createCatalogRegistry`; the workspace `root` for entry loading is the project's
`.waypoint/` dir (which already has `quests/` + `recipes/` subdirs), so the
existing `loadQuestEntries` / `loadRecipeEntries` helpers can be reused (extracted
or exported as needed). `relativePath`/`path` on merged entries point at whichever
source won.

### Merge semantics

- Quests: `merged.quests = bundled.quests ⊕ workspace.quests` (workspace key wins).
- Recipes: `merged.recipes = bundled.recipes ⊕ workspace.recipes` (workspace key wins).
- `questEntries` / `recipeEntries`: the merged, slug-deduped, slug-sorted lists.
- `resolveQuestRecipes(slug)`: identical algorithm to the bundled loader, run over
  the merged registries — so a quest's `recipes: [...]` resolve from the merged set.

## Consumer wiring

Replace `loadBundledWaypointCatalog()` with
`loadWorkspaceWaypointCatalog(projectRoot)` at:

| Site | File:line | Effect |
|------|-----------|--------|
| `run.start` → `startQuestRoute` (folder) | `waypoint-folder-host/src/routes/start.ts:44` | resolution succeeds for authored quests |
| `startQuestRoute` → beads instantiate | `waypoint-folder-host/src/routes/start.ts:75` | beads instantiate sees the merged catalog |
| `catalog.quests` | `waypoint-engine-host/src/core/commands/catalog.ts:10` | lists authored + bundled |
| `catalog.recipes` | `waypoint-engine-host/src/core/commands/catalog.ts:14-26` | resolves an authored quest's recipes |

- `startQuestRoute` already takes `projectRoot`; it keeps reading the local quest
  manifest via `readLocalQuestManifest`. The single change is that **recipe
  resolution** now succeeds for authored quests, and beads instantiation uses the
  merged catalog.
- The `catalog.ts` commands change `ctx.session.requireActive()` to capture
  `{ root }` (currently discarded) and pass it to the loader.

## Error / edge handling

- **No workspace catalog yet** (`.waypoint/quests` and/or `.waypoint/recipes`
  missing): the loader treats workspace contributions as empty → behavior is
  identical to bundled-only today. No throw.
- **Malformed authored manifest**: surfaces the same parse error the bundled
  loader throws today (`invalid Quest manifest: <path>` /
  `invalid Recipe manifest: <path>`) — fail-loud, consistent.
- **Unresolved recipe slug** (authored quest references a recipe present in
  neither source): unchanged `resolveQuestRecipes` error
  (`unresolved recipe slug(s): …`).

## Testing (TDD)

**Loader unit tests** (`packages/waypoint-folder-host/src/catalog/workspace.test.ts`):

- authored-only quest + recipe (not in bundle) resolves via `resolveQuestRecipes`;
- a workspace quest/recipe with a bundled slug **shadows** the bundled one;
- an authored quest referencing one authored + one bundled recipe resolves both;
- missing `.waypoint/quests` and/or `.waypoint/recipes` → bundled-only, no throw;
- malformed authored manifest throws the existing parse error;
- `catalog.quests`-style `quests.list()` includes both authored and bundled slugs.

**End-to-end** (folder backend, engine-host):

- `author.promote` → `author.approveProposal` → `run.start { quest: <authored> }`
  **succeeds** and creates a route (regression: this throws today);
- `catalog.quests` includes the authored slug after approval.

## Out of scope (YAGNI)

- Entry provenance / `source: 'bundled' | 'workspace'` badges on catalog entries.
- Workflow-file authoring or runtime workflow-file loading.
- Beads ad-hoc parity (already a separate tracked follow-up).

## Affected files (anticipated)

- **new** `packages/waypoint-folder-host/src/catalog/workspace.ts` — the loader.
- **new** `packages/waypoint-folder-host/src/catalog/workspace.test.ts` — unit tests.
- `packages/waypoint-folder-host/src/catalog/bundled.ts` — possibly export
  internal entry-loaders / registry helper for reuse (no behavior change).
- `packages/waypoint-folder-host/src/index.ts` — export the new loader.
- `packages/waypoint-folder-host/src/routes/start.ts` — use the workspace loader.
- `packages/waypoint-engine-host/src/core/commands/catalog.ts` — use the
  workspace loader with `root`.
- engine-host e2e test file for the approve→run flow.
