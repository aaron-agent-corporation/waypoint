# Spine — Remaining Roadmap

**Status:** Roadmap refreshed after cleanup close-out and package-readiness selection
**Date:** 2026-05-07
**Purpose:** Keep the project pointed at a defined destination instead of choosing the next road segment after each slice.

---

## Current ground truth

As of this refresh:

- Standalone repo exists at `/Users/aaronwhaley/Github/runner`.
- `main` is pushed to `origin/main` through `26b041a` (`feat(folder-host): rename catalog to runner`), verified during the package-readiness planning turn.
- `@projectrunner/spine` lives in `src/` and exports host-agnostic contracts, command parser, route helpers, discussion helpers, Quest/Recipe parsers, registries, loaders, and resolution helpers.
- Bundled Quest/Recipe catalog is present:
  - `37` Quest manifests.
  - `35` Recipe manifests.
  - `33` Spine source-derived Recipe manifests.
  - `65` source project command mappings documented.
- Current package shape is a private pnpm workspace with root `@projectrunner/spine`, internal `@projectrunner/spine-folder-host`, and internal `@projectrunner/spine-cli`; the CLI remains source-run/development-only, not globally published.

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

### Track 4 — Spine Quest Port

**Status:** Complete through P8.

**Delivered:**
- Main Quest: `quests/runner.yaml`.
- Full Spine source-derived Recipe library: `recipes/runner/*.yaml`.
- Catalog Quest manifests for Spine source-derived command workflows.
- Machine-readable and human-readable command maps:
  - `docs/quests/runner-command-map.yaml`
  - `docs/quests/runner-command-map.md`
- Operator guide: `docs/quests/runner.md`.
- Catalog: `docs/runner-quest-catalog.md`.
- Close-out/status docs:
  - `SPINE_RESUME_PLAN.md`
  - `docs/plans/runner-source-port-status.md`

**Explicitly deferred by Track 4:**
- Folder-host runtime execution.
- Live Recipe execution.
- First-class sub-Quest composition fields.
- Optional `ns-*` namespace commands.

---

### Track 1 — Standalone Folder Host + CLI

**Status:** Complete through F12.

**Plan:** `docs/plans/runner-standalone-folder-host-implementation-plan.md`.

**Close-out:** `docs/plans/spine-folder-host-closeout.md`.

**Delivered:**
- Private pnpm workspace package shape for root core, folder host, and CLI packages.
- `runner init/status/quests/recipes/lifecycle/start/routes/route/route-events/tasks/discuss/gate/pause/resume/auto` development CLI surface.
- Project-local `.runner/` config, catalog, lifecycle YAML, route YAML, event JSONL, task YAML, discussion JSONL, and autopilot run history.
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

## Finished integration / cleanup tracks

### Track 3 — Hermes Runtime + Operator Bridge

**Status:** Complete through H6 as a reference bridge.

**Plan:** `docs/plans/runner-hermes-integration-plan.md`.

**Delivered:**
- Trusted project registry for local Spine projects.
- Safe allowlisted Spine command runner.
- Hermes Recipe runtime reference adapter.
- Task discussion loop with agent-authored loop prevention.
- Telegram gate-loop reference adapter.
- End-to-end Hermes operator smoke against one temp `.runner/` project.

**Boundary:** This is a reference bridge and smoke-proven adapter layer, not a production Hermes gateway service.

---

### Cleanup Track — Spine Catalog Rename + Workflow Scaffold

**Status:** Complete.

**Plan:** `docs/plans/runner-catalog-rename-and-workflow-scaffold-plan.md`.

**Delivered:**
- Active Quest slug/path renamed to `runner` / `quests/runner.yaml`.
- Active Recipe path/slugs renamed to `recipes/runner/*.yaml` / `runner-*`.
- Active docs/tests/smokes updated to use `--quest runner`.
- Scaffold task semantics now distinguish `checkpoint`, `discussion`, `recipe`, and `gate` instead of treating `plan_ref` as an executable Recipe slug.
- Folder-host smoke proves checkpoint events complete without recipe fallback and recipe tasks use explicit metadata bindings.

**Close-out evidence:** cleanup landed in `26b041a` and was pushed to `origin/main` during the package-readiness planning turn.

---

## Active destination

### Track 5 — Package + Install Readiness

**Status:** Active — selected by Aaron after cleanup close-out.

**Plan:** `docs/plans/runner-package-install-readiness-plan.md`.

**Goal:** Make Spine consumable as installable built packages, with emitted JS/declaration output and an installed CLI smoke before Mission Control consumes it.

**Why now:** Mission Control cutover should depend on a stable package/install shape, not on source-run TypeScript entrypoints or local path assumptions.

**Likely slices:**
1. **B0 — Roadmap/plan refresh:** commit this selected destination.
2. **B1 — Build pipeline:** emit JS/declarations and point package exports/bin at built files.
3. **B2 — Built-output boundaries:** verify core/folder-host/CLI built imports and CLI bin without Vitest aliases.
4. **B3 — Local install smoke:** pack/install into a temp project and run the installed `runner` bin through the folder-host journey.
5. **B4 — Consumption strategy:** document GitHub/private registry/git dependency/local-path options and rollback rules.
6. **B5 — Release candidate gate:** run build/test/typecheck/smokes and tag a package-readiness candidate if approved.

---

## Later tracks

### Track 2 — Mission Control Cutover

**Status:** Later — next major destination after Track 5.

**Goal:** Mission Control consumes external `@projectrunner/spine`/Spine package instead of a local copy/path alias.

**Why later:** Track 5 must stabilize package boundaries first. Cutting MC over before the CLI/folder-host package shape is install-smoke-proven would create churn.

**Likely slices:**
1. Consume the selected package source from Track 5.
2. Update Mission Control dependency and imports.
3. Run full MC regression.
4. Document release/bump process.
5. Record rollback pin/tag.

---

## Cleanup / release hygiene backlog

These are not the next road. They are parking-lot items to pull in when they unblock the active track.

- **Package publication:** private registry/GitHub install/tagging once emitted JS build output and global/bin install are tested.
- **Forgejo remote:** add later if still wanted and credentials are available.
- **First-class sub-Quest schema:** later schema evolution; current command/sub-Quest intent is metadata-backed.
- **Optional `ns-*` commands:** deferred from Spine source port.
- **Mission Control historical names:** `gsd_enabled` / `gsd_*` renames remain MC-side cleanup, not standalone folder-host work.
- **Network sync/web UI:** future product tracks after the local folder host works.

---

## Recommended execution order

1. **B0:** commit this roadmap refresh and the Package + Install Readiness implementation plan.
2. **B1:** add emitted JS/declaration build output and package exports/bin that point at built files.
3. **B2:** verify built-output import boundaries without TypeScript source execution or Vitest aliases.
4. **B3:** add a local tarball/install smoke that runs the installed `runner` bin in a temp project.
5. **B4:** document the private consumption strategy and rollback rule for Mission Control.
6. **B5:** run build/test/typecheck/smokes and create a package-readiness candidate tag if approved.
7. **Then start Track 2 — Mission Control Cutover** using the proven package/install shape.

---

## Execution rule

When Aaron asks “what’s next,” do not infer a fresh roadmap from vibes. Check this document and the active implementation plan, verify repo state with git/files/tests, then execute or report the next phase in the already-defined sequence.
