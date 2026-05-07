# Waypoint — Remaining Roadmap

**Status:** Roadmap refreshed after Track 4 close-out  
**Date:** 2026-05-06  
**Purpose:** Keep the project pointed at a defined destination instead of choosing the next road segment after each slice.

---

## Current ground truth

As of this refresh:

- Standalone repo exists at `/Users/aaronwhaley/Github/waypoint`.
- `main` is synced with `origin/main` at `a6823a0 docs(gsd-port): record P8 close-out commit`.
- `@waypoint/core` lives in `src/` and exports host-agnostic contracts, command parser, route helpers, discussion helpers, Quest/Recipe parsers, registries, loaders, and resolution helpers.
- Bundled Quest/Recipe catalog is present:
  - `37` Quest manifests.
  - `35` Recipe manifests.
  - `33` GSD-derived Recipe manifests.
  - `65` GSD source command mappings documented.
- Current package shape is still a single private package named `@waypoint/core`; there is no installable `waypoint` CLI yet.

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

## Active destination

## Track 1 — Standalone Folder Host + CLI

**Status:** Next active track.

**Plan:** `docs/plans/waypoint-standalone-folder-host-implementation-plan.md`.

**Older context plan:** `docs/plans/waypoint-folder-host.md` remains as historical design input, but the implementation plan above is now the controlling roadmap for execution.

**Goal:** Run Waypoint on any project folder with no Mission Control, no database, and no HTTP server.

**North-star command flow:**

```bash
cd ~/projects/project-quest
waypoint init --quest gsd
waypoint status
waypoint quests
waypoint recipes
waypoint start --quest gsd
waypoint routes
waypoint route --route-id route-001
waypoint discuss --task-id task-001 --message "Clarify the objective"
waypoint gate --route-id route-001 --node human_plan_gate --approve --note "Plan accepted"
waypoint auto --max-iterations 10
```

**Track 1 milestones:**

### Milestone A — Installable local shell, no route execution yet

**Goal:** A project folder can be initialized, enabled, and inspected.

Phases:
- **F0:** package/CLI scaffold.
- **F1:** `.waypoint/` config/init/status.
- **F2:** bundled Quest/Recipe catalog commands.
- **F3:** lifecycle YAML store and commands.

**Gate A:** In a temp folder, `waypoint init --quest gsd`, `waypoint status`, `waypoint quests`, and lifecycle add/list commands work and persist readable YAML.

### Milestone B — Stateful route runtime with null Recipe execution

**Goal:** A Quest can start a Route, materialize tasks/events, and advance through manual gates without calling external agents.

Phases:
- **F4:** route store and event log.
- **F5:** Quest start/scaffold instantiation.
- **F6:** route detail/events/status.
- **F7:** gate/pause/resume state transitions.
- **F8:** task materialization and discussion JSONL.
- **F9:** null-runtime autopilot.

**Gate B:** In a temp folder, `waypoint start --quest gsd`, `waypoint routes`, `waypoint route`, `waypoint route-events`, `waypoint discuss`, `waypoint gate`, and `waypoint auto --max-iterations N` work with all state visible under `.waypoint/`.

### Milestone C — Local Recipe execution and operator-ready docs

**Goal:** Waypoint can invoke configured local agent commands from Recipe manifests and has a documented example project.

Phases:
- **F10:** local Recipe runtime adapter.
- **F11:** generated/example project and docs.
- **F12:** release/readiness cleanup.

**Gate C:** Example project runs from scratch using documented commands. Full tests/typecheck pass. Docs explain null vs local runtime and rollback/deletion of `.waypoint/`.

**Ends when:** A new folder can adopt the bundled GSD Quest, persist `.waypoint/` state, start/list/inspect routes, handle gates, record discussion, and run null-runtime autopilot locally. Local Recipe runtime is opt-in and documented.

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

- **Package shape:** decide whether to introduce `pnpm-workspace.yaml` or keep internal package folders under the root TS config for now.
- **Package publication:** private registry/GitHub install/tagging once folder host has a stable CLI.
- **Root package metadata:** current root package is private `@waypoint/core`; Track 1 will need CLI package metadata but should not claim publication until tested.
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
7. **Track 1 / F10–F12:** local Recipe runtime, example project, docs, close-out.
8. **Then choose between Track 2 and Track 3 based on actual need.**

---

## Execution rule

When Aaron asks “what’s next,” do not infer a fresh roadmap from vibes. Check this document and the active implementation plan, verify repo state with git/files/tests, then execute or report the next phase in the already-defined sequence.
