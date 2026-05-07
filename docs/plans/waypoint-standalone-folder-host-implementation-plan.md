# Waypoint Standalone Folder Host Implementation Plan

> **For Gary/Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Do not improvise the next road segment after each slice; execute this map in order unless repo evidence or Aaron explicitly changes it.

**Goal:** Ship a local-first Waypoint host and CLI that can run a bundled Quest, persist project state under `.waypoint/`, expose status/routes/gates/discussion, and eventually invoke local Recipe agents.

**Architecture:** Keep `src/` as `@waypoint/core`. Add a filesystem-backed host package under `packages/waypoint-folder-host/` and a thin CLI package under `packages/waypoint-cli/`. The folder host implements core contracts with YAML/JSONL files; the CLI translates user commands into host calls. Phase 1 is stateful/null-runtime only; Phase 2 adds local Recipe execution.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, `yaml`, Node `fs/promises`, `.waypoint/` YAML state files, JSONL event logs.

---

## Authority stack

1. **Current repo state is source of truth.** At planning time the repo is `main` at `a6823a0`, clean, synced with `origin/main`, with `src/` containing core contracts, Quest/Recipe loaders, command parser, discussion helpers, route helpers, and tests.
2. **Committed docs define accepted intent.** Relevant docs: `docs/plans/waypoint-folder-host.md`, `docs/plans/waypoint-remaining-roadmap.md`, `docs/waypoint-core-integration.md`, `docs/quests/gsd.md`, `docs/waypoint-quest-catalog.md`.
3. **Prior chats provide rationale only.** The end goal is not “whatever comes next”; it is a usable folder host: `cd project && waypoint init --quest gsd && waypoint status` backed by real `.waypoint/` state.

---

## North-star user journey

By the end of this track, a user can run:

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

And Waypoint creates/maintains:

```text
.waypoint/
  config.yaml
  quests/
  recipes/
  lifecycle/
    workstreams.yaml
    milestones.yaml
    phases.yaml
    plans.yaml
  routes/
    route-001.yaml
  events/
    route-001.jsonl
  tasks/
    task-001.yaml
    task-001-discussion.jsonl
  .lock
```

---

## Product boundary for this track

### In scope

- Local `.waypoint/` project directory.
- CLI commands for init/status/catalog/start/routes/route-events/gate/pause/resume/discuss/auto.
- YAML-backed lifecycle and route state.
- JSONL append-only route/discussion events.
- Bundled Quest/Recipe catalog adoption, especially `gsd`.
- Null runtime first, then local runtime.
- Tests proving behavior from a temporary folder, not mocked-only internals.

### Out of scope until after this track

- Network sync or remote Waypoint server.
- Multi-user concurrent collaboration.
- Mission Control cutover.
- Real Hermes gateway integration.
- First-class sub-Quest schema composition.
- Publishing/tagging release process, except package metadata needed for local CLI execution.

---

## Track structure

This track is split into three milestones. Each milestone has a concrete end-to-end gate.

### Milestone A — Installable local shell, no route execution yet

**Goal:** A project folder can be initialized, enabled, and inspected.

Phases:
- F0 — package/CLI scaffold
- F1 — `.waypoint/` config/init/status
- F2 — bundled Quest/Recipe catalog commands
- F3 — lifecycle YAML store and commands

**Gate A:** In a temp folder, `waypoint init --quest gsd`, `waypoint status`, `waypoint quests`, and lifecycle add/list commands work and persist readable YAML.

### Milestone B — Stateful route runtime with null Recipe execution

**Goal:** A Quest can start a Route, materialize tasks/events, and advance through manual gates without calling external agents.

Phases:
- F4 — route store and event log
- F5 — Quest start/scaffold instantiation
- F6 — route detail/events/status
- F7 — gate/pause/resume state transitions
- F8 — task materialization and discussion JSONL
- F9 — null-runtime autopilot

**Gate B:** In a temp folder, `waypoint start --quest gsd`, `waypoint routes`, `waypoint route`, `waypoint route-events`, `waypoint discuss`, `waypoint gate`, and `waypoint auto --max-iterations N` work with all state visible under `.waypoint/`.

### Milestone C — Local Recipe execution and operator-ready docs

**Goal:** Waypoint can invoke configured local agent commands from Recipe manifests and has a documented example project.

Phases:
- F10 — local Recipe runtime adapter
- F11 — generated/example project and docs
- F12 — release/readiness cleanup

**Gate C:** Example project runs from scratch using the documented commands. Full tests/typecheck pass. Docs explain null vs local runtime and rollback/deletion of `.waypoint/`.

---

## Implementation phases and tasks

## Current execution state

- F0 — Package and CLI scaffold: complete in `bf4d140`.
- F1 — `.waypoint/` config/init/status: complete in `9b8ec56`.
- F2 — Bundled Quest/Recipe catalog adoption: complete in `32620db`.
- F3 — Lifecycle YAML store and commands: complete in `4ba9013`.
- F4 — Route and event persistence: complete in `d0b048d`.
- F5 — Start Quest and scaffold project state: complete in `3afadee`.
- F6 — Route status, list, detail, events: complete in `905c29a`.
- F7 — Gate decisions, pause, resume, state transitions: next.

## F0 — Package and CLI scaffold

**Objective:** Establish the package layout and prove the CLI can run without host-specific imports leaking into core/folder-host.

**Files:**
- Create: `packages/waypoint-folder-host/package.json`
- Create: `packages/waypoint-folder-host/src/index.ts`
- Create: `packages/waypoint-folder-host/src/boundaries.test.ts`
- Create: `packages/waypoint-cli/package.json`
- Create: `packages/waypoint-cli/src/bin.ts`
- Create: `packages/waypoint-cli/src/index.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Tasks:**
1. Add a failing CLI smoke test that executes `node packages/waypoint-cli/src/bin.ts --version` or an equivalent TS runner path and expects the repo package version.
2. Add `packages/waypoint-folder-host/src/boundaries.test.ts` that scans folder-host imports and allows only `@waypoint/core`, package-internal relative imports, and Node built-ins.
3. Add package directories with minimal exports.
4. Add root scripts: `cli`, `test`, `typecheck` still work; add package include globs to `tsconfig.json` and `vitest.config.ts`.
5. Run targeted tests, then `pnpm test`, then `pnpm typecheck`.
6. Commit: `feat(folder-host): scaffold host and cli packages`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host packages/waypoint-cli
pnpm test
pnpm typecheck
```

---

## F1 — Project discovery, config, init, status

**Objective:** Create and read `.waypoint/config.yaml` in any folder.

**Files:**
- Create: `packages/waypoint-folder-host/src/project/root.ts`
- Create: `packages/waypoint-folder-host/src/project/config.ts`
- Create: `packages/waypoint-folder-host/src/project/init.ts`
- Create: `packages/waypoint-folder-host/src/project/status.ts`
- Create: `packages/waypoint-cli/src/commands/init.ts`
- Create: `packages/waypoint-cli/src/commands/status.ts`
- Modify: `packages/waypoint-cli/src/bin.ts`

**Config shape v1:**
```yaml
schema_version: 1
enabled: true
quest: gsd
runtime:
  recipe: null
created_at: "2026-05-06T00:00:00.000Z"
updated_at: "2026-05-06T00:00:00.000Z"
```

**Tasks:**
1. RED: test `initWaypointProject(tmp, { quest: 'gsd' })` creates `.waypoint/config.yaml` and required subdirectories.
2. Implement root discovery and safe mkdir/write helpers.
3. RED: test `readWaypointStatus(tmp)` reports missing/uninitialized before init and enabled after init.
4. Implement status reader.
5. Wire CLI `init` and `status`.
6. Verify CLI against a temp directory.
7. Commit: `feat(folder-host): add project init and status`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/project packages/waypoint-cli
pnpm typecheck
```

---

## F2 — Bundled Quest and Recipe catalog adoption

**Objective:** Make the CLI aware of bundled Quests/Recipes and copy or reference them during init.

**Files:**
- Create: `packages/waypoint-folder-host/src/catalog/bundled.ts`
- Create: `packages/waypoint-folder-host/src/catalog/install.ts`
- Create: `packages/waypoint-cli/src/commands/quests.ts`
- Create: `packages/waypoint-cli/src/commands/recipes.ts`
- Modify: `packages/waypoint-cli/src/commands/init.ts`

**Tasks:**
1. RED: test bundled loader finds repo-root `quests/gsd.yaml` and 33 `recipes/gsd/*.yaml` from the package/repo root.
2. Implement catalog root resolution that works in repo dev mode.
3. RED: test `waypoint quests` lists `gsd` and `waypoint recipes --quest gsd` lists referenced recipes.
4. Implement CLI catalog commands.
5. RED: test `waypoint init --quest gsd` records `quest: gsd` and installs or records catalog references in `.waypoint/`.
6. Implement catalog install/reference behavior. Prefer copying manifests into `.waypoint/quests` and `.waypoint/recipes` for local portability unless this creates maintenance pain.
7. Commit: `feat(folder-host): add bundled Quest and Recipe catalog`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/catalog packages/waypoint-cli
pnpm test
pnpm typecheck
```

---

## F3 — Lifecycle YAML store and commands

**Objective:** Persist workstreams, milestones, phases, and plans under `.waypoint/lifecycle/`.

**Files:**
- Create: `packages/waypoint-folder-host/src/lifecycle/types.ts`
- Create: `packages/waypoint-folder-host/src/lifecycle/store.ts`
- Create: `packages/waypoint-cli/src/commands/lifecycle.ts`

**YAML files:**
- `.waypoint/lifecycle/workstreams.yaml`
- `.waypoint/lifecycle/milestones.yaml`
- `.waypoint/lifecycle/phases.yaml`
- `.waypoint/lifecycle/plans.yaml`

**Tasks:**
1. RED: create workstream in temp project, assert YAML row and returned id/key.
2. Implement workstream create/list with duplicate-key validation.
3. RED/implement milestone create/list, requiring existing workstream key.
4. RED/implement phase create/list, requiring existing milestone key.
5. RED/implement plan create/list, requiring existing phase key.
6. Wire CLI:
   - `waypoint lifecycle add workstream --key core --name Core`
   - `waypoint lifecycle add milestone --workstream core --key v1 --title "First Release"`
   - `waypoint lifecycle add phase --milestone v1 --key execute --lifecycle execute`
   - `waypoint lifecycle add plan --phase execute --ref P-1 --title "Build intake form"`
7. Add `waypoint lifecycle list` summary.
8. Commit: `feat(folder-host): add YAML lifecycle store`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/lifecycle packages/waypoint-cli/src/commands/lifecycle.test.ts
pnpm typecheck
```

---

## F4 — Route and event persistence

**Objective:** Add route YAML records and append-only JSONL event logs.

**Files:**
- Create: `packages/waypoint-folder-host/src/routes/types.ts`
- Create: `packages/waypoint-folder-host/src/routes/store.ts`
- Create: `packages/waypoint-folder-host/src/events/jsonl.ts`
- Create: `packages/waypoint-folder-host/src/events/event-bus.ts`

**Tasks:**
1. RED: create route record, assert `.waypoint/routes/route-001.yaml` exists with status/current node/subject.
2. Implement deterministic route id generation by scanning route files.
3. RED: append event, assert `.waypoint/events/route-001.jsonl` has one valid JSON line.
4. Implement JSONL append/read with pagination.
5. Implement folder `IEventBus` adapter as append-only event bus.
6. Commit: `feat(folder-host): add route and event persistence`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/routes packages/waypoint-folder-host/src/events
pnpm typecheck
```

---

## F5 — Start Quest and scaffold project state

**Objective:** `waypoint start --quest gsd` creates a route and scaffolds lifecycle state from the Quest manifest.

**Files:**
- Create: `packages/waypoint-folder-host/src/quests/scaffold.ts`
- Create: `packages/waypoint-folder-host/src/routes/start.ts`
- Create: `packages/waypoint-cli/src/commands/start.ts`

**Tasks:**
1. RED: starting `gsd` in an initialized temp project creates lifecycle workstreams/milestones/phases/plans from `quests/gsd.yaml` scaffolds.
2. Implement scaffold application idempotently: rerunning start must not duplicate lifecycle rows.
3. RED: starting `gsd` creates `route-001.yaml` and `route.started` event.
4. Implement route start using loaded Quest manifest and recipe resolution.
5. Wire CLI `waypoint start --quest gsd` and alias `waypoint start plan --plan-id P-1` only if the existing command parser supports it cleanly.
6. Commit: `feat(folder-host): start Quest routes from local folders`.

**Status:** Complete in `3afadee`. `waypoint start --quest gsd` now creates a route, appends `route.started`, and idempotently scaffolds 1 workstream, 1 milestone, 6 phases, and 12 plans from `quests/gsd.yaml`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/quests packages/waypoint-folder-host/src/routes packages/waypoint-cli/src/commands/start.test.ts
pnpm test
pnpm typecheck
```

---

## F6 — Route status, list, detail, events

**Objective:** Make route state inspectable through CLI commands.

**Files:**
- Create: `packages/waypoint-cli/src/commands/routes.ts`
- Create: `packages/waypoint-cli/src/commands/route.ts`
- Create: `packages/waypoint-cli/src/commands/route-events.ts`
- Modify: `packages/waypoint-folder-host/src/project/status.ts`

**Tasks:**
1. RED: `waypoint routes` lists active route id/status/quest/current node.
2. Implement route list formatting and JSON output option if cheap (`--json`).
3. RED: `waypoint route --route-id route-001` prints full route summary.
4. Implement route detail command.
5. RED: `waypoint route-events --route-id route-001 --limit 10 --offset 0` reads JSONL events with pagination.
6. Implement route-events command.
7. Extend `waypoint status` to summarize project enabled state, active quest, route counts, and blocked gates.
8. Commit: `feat(folder-host): add route inspection commands`.

**Status:** Complete in `905c29a`. `waypoint routes`, `waypoint route --route-id`, and `waypoint route-events --route-id` now inspect route YAML and JSONL event state. `waypoint status` now includes route counts, active routes, blocked routes, and blocked-gate placeholder count pending F7 gate state.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/routes.test.ts packages/waypoint-cli/src/commands/route.test.ts packages/waypoint-cli/src/commands/route-events.test.ts
pnpm typecheck
```

---

## F7 — Gate decisions, pause, resume, state transitions

**Objective:** Support manual human gates and route state controls.

**Files:**
- Create: `packages/waypoint-folder-host/src/routes/state.ts`
- Create: `packages/waypoint-cli/src/commands/gate.ts`
- Create: `packages/waypoint-cli/src/commands/pause.ts`
- Create: `packages/waypoint-cli/src/commands/resume.ts`

**Tasks:**
1. RED: approving a gate updates route YAML and appends `route.gate.approved` event.
2. Implement gate decision persistence with exactly-one approve/reject validation.
3. RED: rejecting a gate marks route blocked or failed according to the v1 route model and records note.
4. Implement rejection path.
5. RED: pause/resume commands change route status and append events.
6. Implement pause/resume.
7. Commit: `feat(folder-host): add gate and route state controls`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/routes/state.test.ts packages/waypoint-cli/src/commands/gate.test.ts
pnpm typecheck
```

---

## F8 — Task materialization and local discussion logs

**Objective:** Create task YAML records for Recipe/review nodes and support task-scoped discussion without external agents.

**Files:**
- Create: `packages/waypoint-folder-host/src/tasks/types.ts`
- Create: `packages/waypoint-folder-host/src/tasks/store.ts`
- Create: `packages/waypoint-folder-host/src/discussion/store.ts`
- Create: `packages/waypoint-cli/src/commands/tasks.ts`
- Create: `packages/waypoint-cli/src/commands/discuss.ts`

**Tasks:**
1. RED: route start materializes task records for discussion-enabled / recipe checkpoints in the Quest scaffold or workflow metadata.
2. Implement task id generation and YAML persistence.
3. RED: discussion message appends to `tasks/task-001-discussion.jsonl` with author/content/timestamp.
4. Implement discussion store using core conversation helpers.
5. Wire CLI `waypoint tasks` and `waypoint discuss --task-id task-001 --message "..."`.
6. Ensure agent-authored loop prevention is represented in metadata even though null runtime does not dispatch.
7. Commit: `feat(folder-host): add task materialization and discussion logs`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/tasks packages/waypoint-folder-host/src/discussion packages/waypoint-cli/src/commands/discuss.test.ts
pnpm test
pnpm typecheck
```

---

## F9 — Null-runtime autopilot

**Objective:** Implement safe local autopilot that advances state until blocked, complete, failed, or iteration cap.

**Files:**
- Create: `packages/waypoint-folder-host/src/runtime/null-runtime.ts`
- Create: `packages/waypoint-folder-host/src/autopilot/run.ts`
- Create: `packages/waypoint-cli/src/commands/auto.ts`

**Tasks:**
1. RED: null runtime records recipe node as skipped/simulated with output metadata, never calls external commands.
2. Implement `NullRecipeRuntime` using core `IRecipeRuntime` shape.
3. RED: autopilot over a simple gate-free test Quest advances to complete within cap.
4. Implement autopilot loop and cap handling.
5. RED: autopilot stops on human gate and reports blocked node.
6. Implement gate stop behavior.
7. Wire CLI `waypoint auto --max-iterations N` and `waypoint auto status` if status history is persisted.
8. Commit: `feat(folder-host): add null-runtime autopilot`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/runtime packages/waypoint-folder-host/src/autopilot packages/waypoint-cli/src/commands/auto.test.ts
pnpm test
pnpm typecheck
```

---

## F10 — Local Recipe runtime

**Objective:** Add opt-in local Recipe execution by invoking a configured command with a stable JSON payload.

**Files:**
- Create: `packages/waypoint-folder-host/src/runtime/local-runtime.ts`
- Create: `packages/waypoint-folder-host/src/runtime/payload.ts`
- Modify: `packages/waypoint-folder-host/src/project/config.ts`
- Modify: `packages/waypoint-cli/src/commands/auto.ts`

**Config extension:**
```yaml
runtime:
  recipe: local
  command: hermes
  args: ["--waypoint-recipe"]
```

**Tasks:**
1. RED: local runtime invokes a mock binary/script with JSON request containing recipe slug, prompt, task id, project root, and route id.
2. Implement payload builder and child-process runner.
3. RED: non-zero command exit records failed runtime handle and event without corrupting route YAML.
4. Implement failure capture.
5. RED: runtime can be selected from config; default remains `null`.
6. Implement runtime selector.
7. Add safety docs in command help: local runtime executes commands and must be explicitly configured.
8. Commit: `feat(folder-host): add opt-in local Recipe runtime`.

**Verification:**
```bash
pnpm exec vitest run packages/waypoint-folder-host/src/runtime packages/waypoint-cli/src/commands/auto.test.ts
pnpm test
pnpm typecheck
```

---

## F11 — Example project and user documentation

**Objective:** Provide a complete reference project and operator guide so the road has a visible destination.

**Files:**
- Create: `examples/folder-host-quest/README.md`
- Create: `examples/folder-host-quest/.gitignore`
- Create: `docs/waypoint-folder-host.md`
- Modify: `README.md`
- Modify: `docs/waypoint-core-integration.md`

**Tasks:**
1. RED: docs smoke test asserts README links to folder host guide and example.
2. Write `docs/waypoint-folder-host.md` with fresh install/dev commands, init/start/status/routes/gate/discuss/auto walkthrough, `.waypoint/` layout, null vs local runtime, and reset instructions.
3. Create example project with a script or README commands that can be run from scratch.
4. Add docs smoke test that command names in guide match actual CLI command registry.
5. Commit: `docs(folder-host): add guide and example project`.

**Verification:**
```bash
pnpm exec vitest run src/__tests__/folder-host-docs.test.ts examples/folder-host-quest
pnpm test
pnpm typecheck
```

---

## F12 — Release/readiness cleanup

**Objective:** Prepare the folder host for ongoing use and future packaging without pretending it is published if it is not.

**Files:**
- Modify: `package.json`
- Modify: `packages/waypoint-cli/package.json`
- Modify: `packages/waypoint-folder-host/package.json`
- Create: `docs/plans/waypoint-folder-host-closeout.md`
- Modify: `docs/plans/waypoint-remaining-roadmap.md`

**Tasks:**
1. Decide package manager shape: keep single root package with internal folders, or introduce `pnpm-workspace.yaml`. Prefer the smallest change that keeps tests/typecheck green.
2. Add root scripts for CLI dev smoke if not already present.
3. Run full test/typecheck.
4. Write closeout doc with exact commands, known limitations, and deferred follow-ups.
5. Update roadmap: Track 1 complete or complete through milestone A/B/C depending actual endpoint.
6. Commit: `docs(folder-host): close out standalone folder host track`.
7. Push only after final verification and `git status` is clean.

**Verification:**
```bash
pnpm test
pnpm typecheck
git status --short --branch
git log --oneline -5
```

---

## Cross-cutting implementation rules

- **Do not skip verification preludes.** Start every execution turn with `git status --short --branch` and `git log --oneline -5`.
- **Do not claim RED-first unless the failing output exists in the same turn.** If test and implementation were written together, say that honestly.
- **Prefer temp-directory integration tests.** A folder host that only passes unit tests against mocks is not proven.
- **Use real parsers/loaders.** Quest/Recipe support must use `parseQuestManifest`, `loadQuestsFromDirectory`, `loadRecipesFromDirectory`, and `resolveQuestRecipes` rather than hand-rolled YAML assumptions.
- **Keep local runtime opt-in.** Null runtime is default. Any command execution must require explicit config.
- **Keep `.waypoint/` human-readable.** YAML/JSONL should be inspectable and git-friendly.
- **Commit one coherent phase at a time.** Each commit must have verification output before reporting.

---

## Dependency decisions to make during F0/F1, not later

1. **Package layout:** current repo is a single package named `@waypoint/core`; F0 must decide whether to introduce workspaces immediately or keep internal packages under root TS config. The lowest-risk path is internal packages first, workspaces later if needed.
2. **CLI runner:** for development tests, use a Node/TS runner path that works without publishing. Do not claim global `waypoint` install until package bin installation is actually tested.
3. **Catalog install model:** copying bundled manifests into `.waypoint/` gives project portability; referencing package manifests avoids drift. Default recommendation: copy on init and record source package/version in config.
4. **Workflow definition parser:** if a full DAG parser is missing from standalone core, do not invent a runtime engine. For Milestone B, drive route state from current Quest scaffolds/checkpoints and record the limitation; add a parser extraction phase only if implementation proves it is required.

---

## Final definition of done

The track is done when all of these are true and verified in the same closeout turn:

- `pnpm test` passes.
- `pnpm typecheck` exits 0.
- A temp-folder smoke script initializes a project, starts `gsd`, lists routes, posts discussion, handles a gate, and runs null autopilot.
- The README and folder-host docs tell a new user exactly how to repeat the smoke.
- `.waypoint/` state is inspectable and contains config, lifecycle, route, event, and task/discussion files.
- Deferred items are explicitly listed, especially network sync, multi-user collaboration, MC cutover, and real Hermes gateway integration.
