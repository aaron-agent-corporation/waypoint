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

## Next track selection

Resolved: Aaron selected Track 3 — Hermes Runtime + Operator Bridge before Mission Control cutover.

## Active destination

### Track 3 — Hermes Runtime + Operator Bridge

**Status:** Active — H5 Telegram gate loop complete.

**Plan:** `docs/plans/waypoint-hermes-integration-plan.md`.

**Goal:** Make Hermes the real runtime and conversational operator layer for standalone Waypoint folders before bridging Waypoint back into Mission Control.

**Why now:** Aaron chose Hermes first because proving real Recipe execution and operator interaction against the folder host should make the later Mission Control bridge an adapter/UI problem instead of a runtime design problem.

**Boundary:** `.waypoint/` remains the standalone source of truth. Hermes is the agent runtime and operator shell. Telegram is the human review/gate surface. Mission Control bridge remains later.

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

### Track 3 — Hermes Runtime + Operator Bridge

**Status:** Active — H5 Telegram gate loop complete.

**Plan:** `docs/plans/waypoint-hermes-integration-plan.md`.

**Goal:** Make Hermes the real runtime and conversational operator layer for standalone Waypoint folders.

**Why now:** Folder host already stabilized the local source-of-truth model. Hermes now needs to prove real Recipe execution, task discussion, and Telegram gate interaction against `.waypoint/` before Mission Control cutover.

**Likely slices:**
1. **H0 — Integration plan and contract boundary:** define folder-host-first architecture, payload shape, command allowlist, safety rules, and MC-later boundary.
2. **H1 — Project registry:** map friendly project names to trusted local paths and Waypoint CLI entrypoints.
3. **H2 — Safe Waypoint command runner:** let Hermes run allowlisted `waypoint` commands and summarize state.
4. **H3 — Hermes Recipe runtime adapter:** receive the F10 local runtime payload and route Recipe slugs to Hermes/Gary agent behavior.
5. **H4 — Discussion loop:** append user and agent-authored task-scoped messages with loop prevention.
6. **H5 — Telegram gate loop:** prompt for approve/reject/revise decisions and apply them through `waypoint gate`.
7. **H6 — End-to-end Hermes smoke:** prove a real Telegram/Hermes workflow writes durable `.waypoint/` route/task/event/discussion evidence.

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
