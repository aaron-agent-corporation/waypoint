# Waypoint — Remaining Roadmap

**Status:** Roadmap refreshed after Track 1 close-out  
**Date:** 2026-05-07  
**Purpose:** Keep the project pointed at a defined destination instead of choosing the next road segment after each slice.

---

## Current ground truth

As of this refresh:

- Standalone repo exists at `/Users/aaronwhaley/Github/waypoint`.
- `main` has completed Track 1 locally through F12; push status must be verified with `git status --short --branch` before release claims.
- `@waypoint/core` lives in `src/` and exports host-agnostic contracts, command parser, route helpers, discussion helpers, Quest/Recipe parsers, registries, loaders, and resolution helpers.
- Bundled Quest/Recipe catalog is present:
  - `37` Quest manifests.
  - `35` Recipe manifests.
  - `33` GSD-derived Recipe manifests.
  - `65` GSD source command mappings documented.
- Current package shape is a private pnpm workspace with root `@waypoint/core`, internal `@waypoint/folder-host`, and internal `@waypoint/cli`; the CLI remains source-run/development-only, not globally published.

---

## Finished tracks

### Track 0 — Quests & Recipes Model

**Status:** Complete.

**Delivered:**
- `QuestManifest` parser and type.
- `RecipeManifest` parser and type.
- Quest/Recipe registries.
- Recursive Quest/Recipe directory loaders.
- Recipe resolution from Quest manifests.
- Worked examples and structural tests.

**Close-out evidence:** covered by the current test suite and exported from `src/index.ts`.

---

### Track 4 — GSD Quest Port

**Status:** Complete through P8.

**Delivered:**
- Main Quest: `quests/gsd.yaml`.
- Full GSD-derived Recipe library: `recipes/gsd/*.yaml`.
- Catalog Quest manifests for GSD-derived command workflows.
- Machine-readable and human-readable command maps:
  - `docs/quests/gsd-command-map.yaml`
  - `docs/quests/gsd-command-map.md`
- Operator guide: `docs/quests/gsd.md`.
- Catalog: `docs/waypoint-quest-catalog.md`.
- Close-out/status docs:
  - `WAYPOINT_RESUME_PLAN.md`
  - `docs/plans/waypoint-gsd-port-status.md`

**Explicitly deferred by Track 4:**
- Folder-host runtime execution.
- Live Recipe execution.
- First-class sub-Quest composition fields.
- Optional `ns-*` namespace commands.

---

### Track 1 — Standalone Folder Host + CLI

**Status:** Complete through F12.

**Plan:** `docs/plans/waypoint-standalone-folder-host-implementation-plan.md`.

**Close-out:** `docs/plans/waypoint-folder-host-closeout.md`.

**Delivered:**
- Private pnpm workspace package shape for root core, folder host, and CLI packages.
- `waypoint init/status/quests/recipes/lifecycle/start/routes/route/route-events/tasks/discuss/gate/pause/resume/auto` development CLI surface.
- Project-local `.waypoint/` config, catalog, lifecycle YAML, route YAML, event JSONL, task YAML, discussion JSONL, and autopilot run history.
- Safe null-runtime autopilot by default.
- Opt-in local Recipe command runtime through `runtime.recipe: local`.
- Runnable example project and operator guide.
- `pnpm smoke:folder-host` temp-project smoke script.

**Explicitly deferred by Track 1:**
- Global/public CLI publication.
- Emitted JS package build/publish pipeline.
- Network sync, multi-user collaboration, and web UI.
- Mission Control cutover to the standalone package.
- Real Hermes gateway integration.

---

## Active destination

Track 1 is complete. There is no active implementation track selected in this roadmap yet.

## Next track selection

Choose the next road explicitly from the later tracks instead of inferring it from nearby files:

- **Track 2 — Mission Control Cutover** if the next priority is consuming the standalone package from Mission Control.
- **Track 3 — Real Hermes Integration** if the next priority is live Recipe/discussion execution through Hermes.

Before starting either track, write a destination-driven implementation plan like the Track 1 plan, then execute one phase at a time with source-of-truth verification.

---

## Later tracks

### Track 2 — Mission Control Cutover

**Status:** Later.

**Goal:** Mission Control consumes external `@waypoint/core`/Waypoint package instead of a local copy/path alias.

**Why later:** Folder host should stabilize package boundaries first. Cutting MC over before the CLI/folder-host package shape settles would create churn.

**Likely slices:**
1. Decide package publication/versioning strategy.
2. Publish or install from GitHub/private registry.
3. Update Mission Control dependency and imports.
4. Run full MC regression.
5. Document release/bump process.

---

### Track 3 — Real Hermes Integration

**Status:** Later.

**Goal:** Real Hermes gateway receives Waypoint discussion/Recipe requests and posts agent replies back into the host.

**Why later:** Folder host first needs a stable local Recipe runtime contract. After that, Hermes can become one runtime adapter instead of being designed against a moving target.

**Likely slices:**
1. Define Hermes gateway endpoint for Recipe/discussion execution.
2. Validate HMAC/shared-secret contract.
3. Route known Recipe slugs to matching agents; unknown slugs fall back to orchestrator.
4. Post replies back as agent-authored discussion messages.
5. End-to-end smoke with loop prevention.

---

## Cleanup / release hygiene backlog

These are not the next road. They are parking-lot items to pull in when they unblock the active track.

- **Package publication:** private registry/GitHub install/tagging once emitted JS build output and global/bin install are tested.
- **Forgejo remote:** add later if still wanted and credentials are available.
- **First-class sub-Quest schema:** later schema evolution; current command/sub-Quest intent is metadata-backed.
- **Optional `ns-*` commands:** deferred from GSD port.
- **Mission Control historical names:** `gsd_enabled` / `gsd_*` renames remain MC-side cleanup, not standalone folder-host work.
- **Network sync/web UI:** future product tracks after the local folder host works.

---

## Recommended execution order

1. **Commit this roadmap refresh and the detailed Track 1 implementation plan.**
2. **Track 1 / F0:** scaffold folder-host and CLI packages.
3. **Track 1 / F1–F3:** get local project init/status/catalog/lifecycle working.
4. **Gate A review:** run temp-folder smoke and update docs if command shape changed.
5. **Track 1 / F4–F9:** build stateful route runtime, gates, discussion, and null autopilot.
6. **Gate B review:** temp-folder end-to-end with `.waypoint/` artifacts inspected.
7. **Track 1 / F10–F12:** local Recipe runtime, example project, docs, close-out. ✅ Complete.
8. **Then choose between Track 2 and Track 3 based on actual need.** This is now the next decision.

---

## Execution rule

When Aaron asks “what’s next,” do not infer a fresh roadmap from vibes. Check this document and the active implementation plan, verify repo state with git/files/tests, then execute or report the next phase in the already-defined sequence.
