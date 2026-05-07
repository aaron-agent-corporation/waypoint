# Waypoint Catalog Rename + Workflow Scaffold Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace active GSD naming with canonical Waypoint naming and fix scaffold execution so Quest checkpoints are workflow nodes, not accidental Recipe slugs.

**Architecture:** Waypoint Quests should materialize a workflow-shaped route: Recipe nodes execute agents, discussion nodes run task-scoped conversations, gate nodes block for human decisions, and non-agent workflow nodes such as checkpoints, waits, delays, timers, and dependency joins are first-class route/task semantics. `plan_ref` remains lifecycle/checkpoint identity. Executable agent work is bound explicitly through metadata or node config; no runtime path falls back from a plan/checkpoint id to a Recipe slug.

**Tech Stack:** TypeScript, YAML manifests, Vitest, pnpm, folder-host `.waypoint/` state, source-run Waypoint CLI.

---

## Current verified root cause

The H6 workaround exists because the current scaffold conflates lifecycle checkpoints with executable Recipe slugs:

- `quests/gsd.yaml` uses `plan_ref` values like `initialize-context`, `initialize-roadmap`, `plan-research`, and `execute-checkpoint`.
- `packages/waypoint-folder-host/src/autopilot/run.ts` resolves non-discussion task Recipes with `return task.plan_ref`.
- Local runtime then looks for `.waypoint/recipes/<plan_ref>.yaml`, but bundled Recipes are named `gsd-*` today.

The fix is not to make every checkpoint execute an agent. The fix is to separate these concepts:

- `plan_ref`: lifecycle/checkpoint identity.
- workflow node type: what the route should do at that step.
- `metadata.waypoint.recipe.slug`: only present when the node is an agent Recipe node.
- discussion/gate/wait/timer/dependency/checkpoint semantics: explicit non-Recipe node types.

---

## User decisions incorporated

1. **Do not make every plan checkpoint execute an agent.** The original Mission Control workflow engine supported Recipes plus other node types: gates, waits, delays, dependency joins, timers, and code/system steps. Folder-host Waypoint needs the same conceptual separation.
2. **Do not preserve active GSD slugs.** Rename active catalog identifiers to Waypoint. There is no working external dependency that requires `gsd` compatibility.
3. **GSD remains history/source attribution only.** References to `get-shit-done-cc`, third-party license notices, and source-command provenance can remain, but active runtime commands/docs/tests should say Waypoint.

---

## Target model

### Quest scaffold plan entries

A scaffold plan entry should be able to describe its workflow role without pretending all roles are Recipes:

```yaml
- plan_ref: initialize-context
  title: Gather project context and starting constraints
  wave: 10
  metadata:
    waypoint:
      node:
        type: checkpoint

- plan_ref: discuss-objective
  title: Run task-scoped discussion to clarify objective and acceptance criteria
  wave: 10
  metadata:
    waypoint:
      node:
        type: discussion
      discussion:
        enabled: true
        agent: waypoint-doc-writer

- plan_ref: plan-research
  title: Research the phase and draft an executable plan
  wave: 10
  metadata:
    waypoint:
      node:
        type: recipe
      recipe:
        slug: waypoint-phase-researcher

- plan_ref: plan-approval-gate
  title: Human approval gate before execution begins
  wave: 20
  metadata:
    waypoint:
      node:
        type: gate
      gate:
        required: true
        kind: plan_approval
```

### Folder-host task kinds

Expand task kinds beyond the current `recipe | discussion | gate` set:

```ts
export type WaypointFolderTaskKind =
  | 'recipe'
  | 'discussion'
  | 'gate'
  | 'checkpoint'
  | 'wait'
  | 'delay'
  | 'timer'
  | 'dependency'
  | 'system'
```

Initial implementation can support the full type union while only executing these behaviors:

- `recipe`: run configured Recipe runtime.
- `discussion`: use discussion metadata and discussion loop.
- `gate`: block route until human gate decision.
- `checkpoint`: mark done under autopilot with `route.autopilot.checkpoint.completed` or equivalent event.
- `wait`, `delay`, `timer`, `dependency`, `system`: fail/stop as unsupported until their semantics are implemented, unless a metadata config gives a safe deterministic behavior.

This keeps architecture honest without overbuilding timer/dependency execution in the rename slice.

---

## Phase W0 — Commit this cleanup plan

**Objective:** Save the accepted destination before implementation begins.

**Files:**
- Create: `docs/plans/waypoint-catalog-rename-and-workflow-scaffold-plan.md`
- Modify: `docs/plans/waypoint-remaining-roadmap.md`

**Steps:**
1. Add this plan.
2. Update the roadmap active destination from Track 3 complete to the cleanup track.
3. Run docs/plan smoke tests if present.
4. Commit with `docs: plan waypoint catalog rename and workflow scaffold`.

**Verification:**

```bash
git status --short --branch
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts src/__tests__/folder-host-docs.test.ts
```

---

## Phase W1 — Add workflow node/task kind semantics

**Objective:** Stop deriving task kind only from discussion/gate metadata and introduce explicit workflow node typing.

**Files:**
- Modify: `packages/waypoint-folder-host/src/tasks/types.ts`
- Modify: `packages/waypoint-folder-host/src/tasks/store.ts`
- Modify tests under `packages/waypoint-folder-host/src/tasks/store.test.ts`

**Implementation:**
1. Add task kinds: `checkpoint`, `wait`, `delay`, `timer`, `dependency`, `system`.
2. Teach `taskKindFor(metadata)` to prefer `metadata.waypoint.node.type` when present.
3. Keep legacy inference only as a migration bridge inside the same manifest edit window:
   - discussion metadata → `discussion`
   - gate metadata → `gate`
   - otherwise default to `checkpoint`, not `recipe`.
4. Preserve all metadata while materializing tasks.

**TDD:**
- Add a failing test that materializes:
  - a checkpoint plan as `kind: checkpoint`
  - a recipe plan with `metadata.waypoint.recipe.slug` as `kind: recipe`
  - a discussion plan as `kind: discussion`
  - a gate plan as `kind: gate`

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/tasks/store.test.ts
```

---

## Phase W2 — Make autopilot execute by node kind, not by plan_ref

**Objective:** Remove the unsafe `plan_ref -> Recipe slug` fallback.

**Files:**
- Modify: `packages/waypoint-folder-host/src/autopilot/run.ts`
- Modify tests under `packages/waypoint-folder-host/src/autopilot/run.test.ts`
- Possibly modify CLI tests under `packages/waypoint-cli/src/commands/auto.test.ts`

**Implementation:**
1. Replace `recipeForTask(task)` with `recipeSlugForTask(task)` that:
   - returns `metadata.waypoint.discussion.agent` for discussion tasks that need an agent runtime path;
   - returns `metadata.waypoint.recipe.slug` for recipe tasks;
   - throws `Recipe task <task-id> (<plan_ref>) is missing metadata.waypoint.recipe.slug` for malformed recipe tasks.
2. Add `checkpoint` behavior:
   - mark task done;
   - update route current node;
   - append a checkpoint event.
3. Add unsupported behavior for `wait`, `delay`, `timer`, `dependency`, and `system` until implemented:
   - mark route blocked or failed with clear reason, depending on final decision in implementation;
   - append an explicit event such as `route.autopilot.unsupported_node`.
4. Keep `gate` behavior unchanged.

**TDD:**
- RED: local runtime should not look for a Recipe manifest named `initialize-context`.
- RED: malformed `kind: recipe` without `metadata.waypoint.recipe.slug` fails with the clear local error.
- GREEN: checkpoint nodes complete without local Recipe runtime.
- GREEN: Recipe nodes execute the configured `waypoint-*` Recipe slug.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/autopilot/run.test.ts packages/waypoint-cli/src/commands/auto.test.ts
```

---

## Phase W3 — Rename main Quest from GSD to Waypoint

**Objective:** Make `waypoint` the canonical Quest slug and file.

**Files:**
- Rename: `quests/gsd.yaml` → `quests/waypoint.yaml`
- Modify: tests referencing `gsd` as the canonical Quest
- Modify: folder-host smoke/docs/examples using `--quest gsd`

**Implementation:**
1. Change Quest manifest:
   - `slug: waypoint`
   - `name: Waypoint Quest`
   - `workflow: workflows/waypoint.yaml` if workflow field remains.
2. Replace `metadata.gsd_port` with `metadata.source_port`.
3. Replace `tags: [gsd-port]` with source/history wording such as `source-port` or `get-shit-done-cc-source`.
4. Update all active commands/docs to use:

```bash
waypoint init --quest waypoint
waypoint start --quest waypoint
waypoint recipes --quest waypoint
```

**Verification:**

```bash
pnpm exec vitest run src/quests packages/waypoint-folder-host/src/catalog packages/waypoint-cli/src/commands/catalog.test.ts
```

---

## Phase W4 — Rename Recipes from `gsd-*` to `waypoint-*`

**Objective:** Make active Recipe slugs Waypoint-native.

**Files:**
- Rename directory: `recipes/gsd/` → `recipes/waypoint/`
- Modify every Recipe manifest slug/name/metadata currently carrying active `gsd-*` branding
- Modify Quest recipe refs
- Modify tests expecting `gsd-*` slugs/counts
- Modify Hermes runtime adapter/tests that route known Recipe slugs

**Implementation:**
1. Rename slugs mechanically:
   - `gsd-doc-writer` → `waypoint-doc-writer`
   - `gsd-planner` → `waypoint-planner`
   - etc.
2. Update `quests/waypoint.yaml` recipe refs.
3. Update discussion agent metadata to `waypoint-doc-writer`.
4. Update Hermes runtime adapter known routes/fallback examples.
5. Keep historical `source.project: get-shit-done-cc` attribution.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/worked-examples.test.ts src/__tests__/gsd-port.test.ts src/__tests__/gsd-docs.test.ts examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts
```

Note: test file names can be renamed in this phase or W6. If renamed, include old-file deletion in the commit.

---

## Phase W5 — Rewrite scaffold metadata to express real workflow nodes

**Objective:** Convert the main Waypoint Quest scaffold from “all non-gates are Recipes” to explicit workflow nodes.

**Files:**
- Modify: `quests/waypoint.yaml`
- Modify: `src/quests/manifest.ts` if `QuestScaffoldPlan` needs typed `metadata`
- Modify task/autopilot tests as needed

**Initial scaffold classification:**

- `initialize-context`: `checkpoint` or `system` until a real intake Recipe is intentionally assigned.
- `initialize-roadmap`: `checkpoint` or `recipe` only if bound to `waypoint-roadmapper` deliberately.
- `discuss-objective`: `discussion`, agent `waypoint-doc-writer`.
- `discuss-assumptions`: `recipe`, slug `waypoint-assumptions-analyzer`, or `checkpoint` if it is operator-only.
- `plan-research`: `recipe`, slug `waypoint-phase-researcher`.
- `plan-approval-gate`: `gate`.
- `execute-slice`: `recipe`, slug `waypoint-executor`.
- `execute-checkpoint`: `checkpoint`.
- `verify-work`: `recipe`, slug `waypoint-verifier`.
- `verify-approval-gate`: `gate`.
- `ship-prep`: `recipe`, slug `waypoint-doc-synthesizer`, or `checkpoint` if docs are operator-owned.
- `ship-approval-gate`: `gate`.

Implementation should choose the smallest honest mapping. If a task is not clearly agent-executable, make it `checkpoint`, not `recipe`.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/tasks/store.test.ts packages/waypoint-folder-host/src/autopilot/run.test.ts src/__tests__/worked-examples.test.ts
```

---

## Phase W6 — Remove active GSD docs/tests/names

**Objective:** Clean user-facing naming. GSD remains source attribution only.

**Files likely affected:**
- `README.md`
- `WAYPOINT_RESUME_PLAN.md`
- `docs/waypoint-quest-catalog.md`
- `docs/quests/gsd.md` → likely `docs/quests/waypoint.md`
- `docs/quests/gsd-command-map.yaml` → likely `docs/quests/source-command-map.yaml` or `docs/quests/get-shit-done-source-command-map.yaml`
- `docs/quests/gsd-command-map.md` → renamed equivalent
- `docs/plans/waypoint-gsd-*` docs → archive/rename or rewrite as source-port history
- `src/__tests__/gsd-port.test.ts` → `src/__tests__/waypoint-catalog.test.ts`
- `src/__tests__/gsd-docs.test.ts` → `src/__tests__/waypoint-docs.test.ts`

**Rules:**
1. Active docs say `waypoint`, `waypoint-*`, and “Waypoint Quest.”
2. Historical docs may say `get-shit-done-cc` only in source attribution sections.
3. No active command examples should use `--quest gsd`.
4. No active runtime tests should expect `gsd-*` Recipe slugs.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/folder-host-docs.test.ts src/__tests__/worked-examples.test.ts src/__tests__/waypoint-catalog.test.ts src/__tests__/waypoint-docs.test.ts
```

---

## Phase W7 — Update H6 smoke to prove the new model

**Objective:** Remove the null/local/null workaround and prove the workflow-node model.

**Files:**
- Modify: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`
- Modify: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`
- Modify: `examples/hermes-operator-adapter/README.md`
- Modify: `docs/plans/waypoint-hermes-integration-plan.md`

**Expected H6 behavior after cleanup:**
1. `waypoint init --quest waypoint`
2. `waypoint start --quest waypoint`
3. configure local Hermes Recipe runtime once
4. run autopilot
5. checkpoint nodes complete without Recipe lookup
6. Recipe nodes execute `waypoint-*` Recipes
7. discussion node still uses `waypoint-doc-writer`
8. gate node blocks until Telegram gate approval
9. no route event proves a fallback from `plan_ref` to Recipe slug

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts src/__tests__/hermes-integration-plan.test.ts
```

---

## Phase W8 — Full regression and close-out

**Objective:** Prove the renamed catalog and workflow scaffold model are stable across folder host, Hermes, docs, and typecheck.

**Commands:**

```bash
pnpm smoke:folder-host
pnpm test
pnpm typecheck
```

**Close-out requirements:**
- `git status --short --branch` is clean after commit.
- `git log --oneline -5` shows the cleanup commits.
- Roadmap marks this cleanup track complete.
- H6 docs no longer describe the old scaffold workaround as current behavior; it may remain in historical notes only if clearly labeled.

---

## Out of scope

- Mission Control database table renames.
- Public/global CLI publication.
- Full timer/delay/dependency scheduler implementation.
- Network sync or web UI.
- Backward-compatible `gsd` aliases, unless explicitly reintroduced later.

---

## Final acceptance gate

This cleanup is complete when all of the following are true:

- Canonical Quest command is `waypoint init --quest waypoint`.
- Canonical Recipe slugs are `waypoint-*`.
- No local runtime path falls back to `task.plan_ref` as a Recipe slug.
- Non-agent checkpoints are represented as non-Recipe workflow/task nodes.
- H6 smoke no longer needs the null/local/null workaround.
- GSD appears only as source attribution/history, not active runtime branding.
- `pnpm smoke:folder-host`, `pnpm test`, and `pnpm typecheck` pass.
