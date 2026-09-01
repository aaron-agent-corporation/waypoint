# Spine — Workspace-Local Catalog Resolution (runner-j3b)

**Date:** 2026-06-23
**Issue:** runner-j3b — Engine Host follow-up: runtime resolution of workspace-authored catalog entries
**Status:** Design approved + MAR-reviewed (run `20260623-BFSAj8`, completed/validated); ready for implementation plan

> This spec is the integrated output of a 3-vendor MAR adversarial review
> (`runs/20260623-BFSAj8/`). The review added D5 (autopilot execution-time
> resolution) and D6 (CLI consumers) after verifying both gaps in source, and
> tightened precedence/determinism. Validation passed (codex/gemini pass,
> claude pass-with-nits); the three validation nits are resolved inline here.

## Problem (current behavior, treated as evidence)

The agent-authoring flow (slice 2) lets a human approve a proposal via
`author.approveProposal`, which lands an approved manifest into the workspace
catalog under the project's `.runner/` directory:

- approved quests → `.runner/quests/<slug>.yaml`
- approved recipes → `.runner/recipes/<slug>.yaml`

(`installQuestCatalog` writes bundled quests/recipes into the same `.runner/`
dirs.) But the runtime resolves quests and recipes only from the **bundled
package catalog** (`loadBundledSpineCatalog()`). The net effect is a dead-end:
**approved proposals land on disk but are not reachable** via `run.start`,
`resolveQuestRecipes`, `catalog.*`, the CLI `quests`/`recipes` commands, or
autopilot's default recipe lookup. Concretely:

- `startQuestRoute` (`routes/start.ts:44-48`) calls
  `loadBundledSpineCatalog().resolveQuestRecipes(quest)` and **throws** when
  the slug isn't in the bundle — even though it later reads the local quest
  manifest via `readLocalQuestManifest` (`:60`, `:135`). So the route already
  trusts a workspace-authored *quest* manifest, but its *recipe resolution* still
  only sees the bundle.
- The beads path instantiates from the bundled catalog
  (`instantiateSpineRouteInBeads(catalog, …)`, `:75`).
- `catalog.quests` (`catalog.ts:10`) and `catalog.recipes` (`catalog.ts:14-26`)
  list/resolve from the bundle only.
- CLI `quests` / `recipes` commands display from the bundled catalog only, so
  approved workspace entries are invisible at the command line.
- Autopilot's default recipe lookup (no ad-hoc `catalogDir`) reads recipes from a
  local catalog directory only (`autopilot/run.ts:425-433`,
  `loadRecipeManifest`), so an authored quest referencing a bundled recipe that
  was never copied into `.runner/recipes` would **start but fail at execution**.

### Narrowing finding (verified during design; re-confirm in implementation)

A quest's `workflow` field is **only ever carried as a metadata string**, never
read as a file at route-start time. `startQuestRoute` and `startAdhocRoute` both
only require `workflow` to be a non-empty string (which the manifest provides)
and store it in route metadata (`routeMetadata` → `runner.workflow`). The real
gap is therefore **workspace-aware recipe/quest resolution**, not workflow-file
loading. Per **D5**, the autopilot change closes the verified recipe-manifest
resolution gap and nothing more.

## Decisions

1. **Resolution model: overlay, workspace-wins** (D1). Merge bundled + workspace
   into one catalog; on a slug collision the **workspace** entry overrides the
   bundled one. This makes authored-only entries resolve, lets a workspace copy
   intentionally customize a bundled quest/recipe, and lets an authored quest
   reference a mix of authored and bundled recipes.
2. **Scope: all resolution consumers** (D2). Route every resolution site through
   the new loader so authored quests are both **runnable** (`run.start`, folder +
   beads; autopilot's default recipe lookup) and **discoverable**
   (`catalog.quests` / `catalog.recipes`; CLI `quests` / `recipes`). The full
   enumerated consumer set is in the **Consumer wiring** table below.
3. **New loader returns the existing `BundledSpineCatalog` interface** (D3),
   making it a drop-in replacement at every call site.
4. **`loadBundledSpineCatalog` is left unchanged** (D4) and is composed by the
   new loader, preserving the bundled-only contract and keeping the change
   additive.
5. **Autopilot default recipe lookup is in scope, bounded to recipe-manifest
   resolution** (D5). In `autopilot/run.ts`, the **default** (no ad-hoc
   `catalogDir`) `loadRecipeManifest` path resolves through the workspace-aware
   loader using the `projectRoot` already in scope, so an authored quest can
   reference a bundled recipe that was never copied into `.runner/recipes`. The
   **ad-hoc `catalogDir` path is preserved unchanged** (see precedence note
   below). This closes a **recipe-resolution** gap only; it does **not** add
   workflow-file loading (still out of scope).
6. **CLI catalog commands resolve via upward `.runner/` discovery** (D6).
   `quests.ts` and `recipes.ts` locate the project by searching upward for the
   nearest `.runner/` ancestor (not `process.cwd()`), so invocation from a
   subdirectory still sees approved workspace entries; when no `.runner/`
   ancestor exists they degrade to bundled-only. `init` and catalog-installation
   flows stay on `loadBundledSpineCatalog()`.

## Architecture

Add one primitive in `packages/spine-folder-host/src/catalog/`:

```ts
loadWorkspaceSpineCatalog(projectRoot: string): Promise<BundledSpineCatalog>
```

It returns the **same `BundledSpineCatalog` interface** as
`loadBundledSpineCatalog`, making it a **drop-in replacement** at every
resolution site (D3). Internally it:

1. loads the bundled package catalog (existing `loadBundledSpineCatalog()`);
2. loads workspace entries from `<projectRoot>/.runner/quests` +
   `<projectRoot>/.runner/recipes` (tolerant of either dir being absent);
3. merges bundled + workspace entries into unified quest/recipe registries with
   **workspace-wins on slug collision**;
4. exposes `resolveQuestRecipes` over the merged registries.

`loadBundledSpineCatalog` is **unchanged** (D4) — it remains the bundled
primitive the new loader composes. The merge reuses the existing manifest
parsers and `createCatalogRegistry` (the exact existing symbol — not a new
`createSpineCatalog`); the workspace `root` for entry loading is the project's
`.runner/` dir (which already has `quests/` + `recipes/` subdirs), so the
existing `loadQuestEntries` / `loadRecipeEntries` helpers are reused (exported
from `bundled.ts` as needed). `relativePath` / `path` on merged entries point at
whichever source won, so Beads source metadata and file-copy consumers reference
the winning manifest source.

### Merge semantics

- Quests: `merged.quests = bundled.quests ⊕ workspace.quests` (workspace key wins).
- Recipes: `merged.recipes = bundled.recipes ⊕ workspace.recipes` (workspace key wins).
- `questEntries` / `recipeEntries`: the merged, slug-deduped, slug-sorted lists.
- `resolveQuestRecipes(slug)`: identical algorithm to the bundled loader, run over
  the merged registries — so a quest's `recipes: [...]` resolve from the merged set.
- **Determinism:** the merge produces a stable, slug-sorted order independent of
  filesystem read order, so `catalog.quests` / `catalog.recipes` output is
  reproducible across machines.

### Autopilot precedence (D5) — no three-way merge

This was a validation nit: there is **no** three-source merge. The autopilot
recipe lookup has exactly two modes, mutually exclusive per call:

- **ad-hoc `catalogDir` supplied** → behavior is **unchanged**: resolve from
  `catalogDir/recipes` **only** (the existing ad-hoc overlay path; workspace and
  bundled are not consulted, exactly as today).
- **no `catalogDir`** (the default path) → resolve through
  `loadWorkspaceSpineCatalog(projectRoot)`, i.e. **workspace > bundled**.

So the effective ordering is "`catalogDir` (when present, exclusive) else
workspace-over-bundled." The ad-hoc execution path keeps its current isolation;
only the default path becomes workspace-aware.

## Consumer wiring

Replace `loadBundledSpineCatalog()` with
`loadWorkspaceSpineCatalog(projectRoot)` (or, for autopilot, route the default
recipe lookup through it) at:

| Site | File:line | Effect |
|------|-----------|--------|
| `run.start` → `startQuestRoute` (folder) | `spine-folder-host/src/routes/start.ts:44` | resolution succeeds for authored quests |
| `startQuestRoute` → beads instantiate | `spine-folder-host/src/routes/start.ts:75` | beads instantiate sees the merged catalog |
| `catalog.quests` | `spine-engine-host/src/core/commands/catalog.ts:10` | lists authored + bundled |
| `catalog.recipes` | `spine-engine-host/src/core/commands/catalog.ts:14-26` | resolves an authored quest's recipes |
| CLI `quests` | `spine-cli/src/commands/quests.ts` | direct CLI listing sees workspace-approved quests (upward `.runner/` discovery) |
| CLI `recipes` | `spine-cli/src/commands/recipes.ts` | direct CLI listing sees workspace-approved recipes (upward `.runner/` discovery) |
| autopilot default recipe lookup | `spine-folder-host/src/autopilot/run.ts` | default (non-`catalogDir`) `loadRecipeManifest` resolves authored + bundled recipes |

- `startQuestRoute` already takes `projectRoot`; it keeps reading the local quest
  manifest via `readLocalQuestManifest`. The single behavioral change is that
  **recipe resolution** now succeeds for authored quests, and beads instantiation
  uses the merged catalog. To avoid two divergent loads in one route call, the
  route resolves the merged catalog **once** and passes that same instance to
  both the recipe-resolution and beads-instantiate steps.
- The `catalog.ts` commands change `ctx.session.requireActive()` to capture
  `{ root }` (currently discarded) and pass it to the loader; preserve the
  existing `NOT_FOUND` `EngineError` behavior when resolution fails.
- The CLI commands (`quests.ts`, `recipes.ts`) find `projectRoot` by walking up
  from the invocation directory to the nearest `.runner/` ancestor; if none is
  found they fall back to bundled-only (no throw). `init` / catalog-install flows
  remain on `loadBundledSpineCatalog()`.
- `autopilot/run.ts` routes **only** the default `loadRecipeManifest` lookup (no
  ad-hoc `catalogDir`) through `loadWorkspaceSpineCatalog(projectRoot)`; the
  ad-hoc `catalogDir` overlay path is preserved unchanged. This is recipe-manifest
  resolution only — the `workflow` field is still not read as a file.

## Error / edge handling

- **No workspace catalog yet** (`.runner/quests` and/or `.runner/recipes`
  missing): the loader treats workspace contributions as empty → behavior is
  identical to bundled-only today. No throw.
- **Empty-but-present dir**: same as missing — contributes zero entries, no throw.
- **Malformed authored manifest**: surfaces the same parse error the bundled
  loader throws today (`invalid Quest manifest: <path>` /
  `invalid Recipe manifest: <path>`) — fail-loud, consistent. The error path
  carries the workspace file path so an author can locate the bad manifest.
- **Unresolved recipe slug** (authored quest references a recipe present in
  neither source): unchanged `resolveQuestRecipes` error
  (`unresolved recipe slug(s): …`).
- **CLI invoked outside any `.runner/` workspace**: no `.runner/` ancestor
  found → bundled-only listing, no throw (D6).

## Testing (TDD)

Write loader unit tests first; they must fail against today's bundled-only
behavior before the loader exists.

**Loader unit tests** (`packages/spine-folder-host/src/catalog/workspace.test.ts`):

- authored-only quest + recipe (not in bundle) resolves via `resolveQuestRecipes`;
- a workspace quest/recipe with a bundled slug **shadows** the bundled one
  (assert the winning entry's `path`/`relativePath` points at the workspace file);
- an authored quest referencing one authored + one bundled recipe resolves both;
- missing `.runner/quests` and/or `.runner/recipes` → bundled-only, no throw;
- empty-but-present `.runner/quests` dir → bundled-only, no throw;
- malformed authored manifest throws the existing parse error with the workspace path;
- `quests.list()` / merged `questEntries` is slug-sorted and deduped, and includes
  both authored and bundled slugs.

**End-to-end** (folder backend, engine-host):

- `author.promote` → `author.approveProposal` → `run.start { quest: <authored> }`
  **succeeds** and creates a route (regression: this throws today);
- `catalog.quests` includes the authored slug after approval;
- `catalog.recipes` for an authored quest resolves its recipe list;
- approved authored quest with Beads backend (injected fake Beads client)
  instantiates from the merged catalog.

**CLI** (`spine-cli`):

- `runner quests` / `runner recipes` include workspace-approved manifests when
  run from a temp initialized project, **including from a subdirectory** of that
  project (exercises upward `.runner/` discovery, D6);
- running the same commands outside any workspace still lists bundled entries.

**Autopilot regression** (folder-host):

- a route task referencing a bundled recipe **not** present in `.runner/recipes`
  still loads that recipe through the workspace catalog loader on the default
  (non-`catalogDir`) path;
- when an ad-hoc `catalogDir` is supplied, recipe lookup stays `catalogDir`-only
  (the ad-hoc path is unchanged; workspace/bundled are not consulted).

## Out of scope (YAGNI)

- Entry provenance / `source: 'bundled' | 'workspace'` badges on catalog entries.
- Workflow-file authoring or runtime workflow-file loading. (The autopilot change
  in D5 is recipe-manifest resolution only and does **not** read the `workflow`
  field as a file.)
- Beads ad-hoc parity (already a separate tracked follow-up).

## Affected files (anticipated)

- **new** `packages/spine-folder-host/src/catalog/workspace.ts` — the loader.
- **new** `packages/spine-folder-host/src/catalog/workspace.test.ts` — unit tests.
- `packages/spine-folder-host/src/catalog/bundled.ts` — export internal
  entry-loaders / `createCatalogRegistry` helper for reuse (no behavior change).
- `packages/spine-folder-host/src/index.ts` — export the new loader.
- `packages/spine-folder-host/src/routes/start.ts` — use the workspace loader.
- `packages/spine-engine-host/src/core/commands/catalog.ts` — use the
  workspace loader with `root`.
- `packages/spine-folder-host/src/autopilot/run.ts` — route the default
  (non-`catalogDir`) recipe lookup through the workspace loader (D5).
- `packages/spine-cli/src/commands/quests.ts` — upward `.runner/` discovery,
  use the workspace loader (D6).
- `packages/spine-cli/src/commands/recipes.ts` — upward `.runner/` discovery,
  use the workspace loader (D6).
- engine-host e2e test file for the approve→run flow; CLI tests; autopilot
  regression test.

## Resolved decisions (record — do not relitigate)

- **D1–D4** — overlay/workspace-wins; all resolution consumers; drop-in
  `BundledSpineCatalog`; bundled loader unchanged.
- **D5** — autopilot default recipe lookup in scope, bounded to recipe-manifest
  resolution; ad-hoc `catalogDir` path unchanged (no three-way merge); no
  workflow-file loading.
- **D6** — CLI `quests`/`recipes` use upward `.runner/` discovery, not
  `process.cwd()`; bundled-only fallback when no workspace root.
- Symbol for reuse is `createCatalogRegistry` (`createSpineCatalog` was a
  drafting slip, corrected).
- Merged entries are slug-sorted and filesystem-order-independent.

## Implementation re-confirmation checklist (not unsettled design forks)

- Re-confirm `runSpineAutopilot` does not read the `workflow` field as a file.
  (Design grep says it does not; if implementation finds otherwise, that is a
  **separate tracked sub-task**, not part of this work.)
- Confirm `bundled.ts`'s entry-loaders and `createCatalogRegistry` can be exported
  for reuse without any behavior change (vs. re-implementing in the new loader).
