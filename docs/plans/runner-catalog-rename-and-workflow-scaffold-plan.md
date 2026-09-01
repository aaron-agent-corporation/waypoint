# Spine Catalog Rename + Workflow Scaffold Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace active GSD naming with canonical Spine naming and fix scaffold execution so Quest checkpoints are workflow nodes, not accidental Recipe slugs.

**Architecture:** Spine Quests should materialize a workflow-shaped route: Recipe nodes execute agents, discussion nodes run task-scoped conversations, gate nodes block for human decisions, and non-agent workflow nodes such as checkpoints, waits, delays, timers, and dependency joins are first-class route/task semantics. `plan_ref` remains lifecycle/checkpoint identity. Executable agent work is bound explicitly through metadata or node config; no runtime path falls back from a plan/checkpoint id to a Recipe slug.

**Tech Stack:** TypeScript, YAML manifests, Vitest, pnpm, folder-host `.runner/` state, source-run Spine CLI.

---

## Current verified root cause

The H6 workaround exists because the current scaffold conflates lifecycle checkpoints with executable Recipe slugs:

- `quests/runner.yaml` uses `plan_ref` values like `initialize-context`, `initialize-roadmap`, `plan-research`, and `execute-checkpoint`.
- `packages/spine-folder-host/src/autopilot/run.ts` resolves non-discussion task Recipes with `return task.plan_ref`.
- Local runtime then looks for `.runner/recipes/<plan_ref>.yaml`, but bundled Recipes are named `runner-*` today.

The fix is not to make every checkpoint execute an agent. The fix is to separate these concepts:

- `plan_ref`: lifecycle/checkpoint identity.
- workflow node type: what the route should do at that step.
- `metadata.runner.recipe.slug`: only present when the node is an agent Recipe node.
- discussion/gate/wait/timer/dependency/checkpoint semantics: explicit non-Recipe node types.

---

## User decisions incorporated

1. **Do not make every plan checkpoint execute an agent.** The original Mission Control workflow engine supported Recipes plus other node types: gates, waits, delays, dependency joins, timers, and code/system steps. Folder-host Spine needs the same conceptual separation.
2. **Do not preserve active GSD slugs.** Rename active catalog identifiers to Spine. There is no working external dependency that requires `gsd` compatibility.
3. **GSD remains history/source attribution only.** References to `get-shit-done-cc`, third-party license notices, and source-command provenance can remain, but active runtime commands/docs/tests should say Spine.

---

## Target model

### Quest scaffold plan entries

A scaffold plan entry should be able to describe its workflow role without pretending all roles are Recipes:

```yaml
- plan_ref: initialize-context
  title: Gather project context and starting constraints
  wave: 10
  metadata:
    runner:
      node:
        type: checkpoint

- plan_ref: discuss-objective
  title: Run task-scoped discussion to clarify objective and acceptance criteria
  wave: 10
  metadata:
    runner:
      node:
        type: discussion
      discussion:
        enabled: true
        agent: runner-doc-writer

- plan_ref: plan-research
  title: Research the phase and draft an executable plan
  wave: 10
  metadata:
    runner:
      node:
        type: recipe
      recipe:
        slug: runner-phase-researcher

- plan_ref: plan-approval-gate
  title: Human approval gate before execution begins
  wave: 20
  metadata:
    runner:
      node:
        type: gate
      gate:
        required: true
        kind: plan_approval
```

### Folder-host task kinds

Expand task kinds beyond the current `recipe | discussion | gate` set:

```ts
export type SpineFolderTaskKind =
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
- Create: `docs/plans/runner-catalog-rename-and-workflow-scaffold-plan.md`
- Modify: `docs/plans/runner-remaining-roadmap.md`

**Steps:**
1. Add this plan.
2. Update the roadmap active destination from Track 3 complete to the cleanup track.
3. Run docs/plan smoke tests if present.
4. Commit with `docs: plan runner catalog rename and workflow scaffold`.

**Verification:**

```bash
git status --short --branch
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts src/__tests__/folder-host-docs.test.ts
```

---

## Phase W1 — Add workflow node/task kind semantics

**Objective:** Stop deriving task kind only from discussion/gate metadata and introduce explicit workflow node typing.

**Files:**
- Modify: `packages/spine-folder-host/src/tasks/types.ts`
- Modify: `packages/spine-folder-host/src/tasks/store.ts`
- Modify tests under `packages/spine-folder-host/src/tasks/store.test.ts`

**Implementation:**
1. Add task kinds: `checkpoint`, `wait`, `delay`, `timer`, `dependency`, `system`.
2. Teach `taskKindFor(metadata)` to prefer `metadata.runner.node.type` when present.
3. Keep legacy inference only as a migration bridge inside the same manifest edit window:
   - discussion metadata → `discussion`
   - gate metadata → `gate`
   - otherwise default to `checkpoint`, not `recipe`.
4. Preserve all metadata while materializing tasks.

**TDD:**
- Add a failing test that materializes:
  - a checkpoint plan as `kind: checkpoint`
  - a recipe plan with `metadata.runner.recipe.slug` as `kind: recipe`
  - a discussion plan as `kind: discussion`
  - a gate plan as `kind: gate`

**Verification:**

```bash
pnpm exec vitest run packages/spine-folder-host/src/tasks/store.test.ts
```

---

## Phase W2 — Make autopilot execute by node kind, not by plan_ref

**Objective:** Remove the unsafe `plan_ref -> Recipe slug` fallback.

**Files:**
- Modify: `packages/spine-folder-host/src/autopilot/run.ts`
- Modify tests under `packages/spine-folder-host/src/autopilot/run.test.ts`
- Possibly modify CLI tests under `packages/spine-cli/src/commands/auto.test.ts`

**Implementation:**
1. Replace `recipeForTask(task)` with `recipeSlugForTask(task)` that:
   - returns `metadata.runner.discussion.agent` for discussion tasks that need an agent runtime path;
   - returns `metadata.runner.recipe.slug` for recipe tasks;
   - throws `Recipe task <task-id> (<plan_ref>) is missing metadata.runner.recipe.slug` for malformed recipe tasks.
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
- RED: malformed `kind: recipe` without `metadata.runner.recipe.slug` fails with the clear local error.
- GREEN: checkpoint nodes complete without local Recipe runtime.
- GREEN: Recipe nodes execute the configured `runner-*` Recipe slug.

**Verification:**

```bash
pnpm exec vitest run packages/spine-folder-host/src/autopilot/run.test.ts packages/spine-cli/src/commands/auto.test.ts
```

---

## Phase W3 — Rename main Quest from GSD to Spine

**Objective:** Make `runner` the canonical Quest slug and file.

**Files:**
- Rename: `quests/runner.yaml` → `quests/runner.yaml`
- Modify: tests referencing `gsd` as the canonical Quest
- Modify: folder-host smoke/docs/examples using `--quest runner`

**Implementation:**
1. Change Quest manifest:
   - `slug: runner`
   - `name: Spine Quest`
   - `workflow: workflows/runner.yaml` if workflow field remains.
2. Replace `metadata.source_port` with `metadata.source_port`.
3. Replace `tags: [runner-port]` with source/history wording such as `source-port` or `get-shit-done-cc-source`.
4. Update all active commands/docs to use:

```bash
runner init --quest runner
runner start --quest runner
runner recipes --quest runner
```

**Verification:**

```bash
pnpm exec vitest run src/quests packages/spine-folder-host/src/catalog packages/spine-cli/src/commands/catalog.test.ts
```

---

## Phase W4 — Rename Recipes from `runner-*` to `runner-*`

**Objective:** Make active Recipe slugs Spine-native.

**Files:**
- Rename directory: `recipes/runner/` → `recipes/runner/`
- Modify every Recipe manifest slug/name/metadata currently carrying active `runner-*` branding
- Modify Quest recipe refs
- Modify tests expecting `runner-*` slugs/counts
- Modify Hermes runtime adapter/tests that route known Recipe slugs

**Implementation:**
1. Rename slugs mechanically:
   - `runner-doc-writer` → `runner-doc-writer`
   - `runner-planner` → `runner-planner`
   - etc.
2. Update `quests/runner.yaml` recipe refs.
3. Update discussion agent metadata to `runner-doc-writer`.
4. Update Hermes runtime adapter known routes/fallback examples.
5. Keep historical `source.project: get-shit-done-cc` attribution.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/worked-examples.test.ts src/__tests__/runner-port.test.ts src/__tests__/runner-docs.test.ts examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts
```

Note: test file names can be renamed in this phase or W6. If renamed, include old-file deletion in the commit.

---

## Phase W5 — Rewrite scaffold metadata to express real workflow nodes

**Objective:** Convert the main Spine Quest scaffold from “all non-gates are Recipes” to explicit workflow nodes.

**Files:**
- Modify: `quests/runner.yaml`
- Modify: `src/quests/manifest.ts` if `QuestScaffoldPlan` needs typed `metadata`
- Modify task/autopilot tests as needed

**Initial scaffold classification:**

- `initialize-context`: `checkpoint` or `system` until a real intake Recipe is intentionally assigned.
- `initialize-roadmap`: `checkpoint` or `recipe` only if bound to `runner-roadmapper` deliberately.
- `discuss-objective`: `discussion`, agent `runner-doc-writer`.
- `discuss-assumptions`: `recipe`, slug `runner-assumptions-analyzer`, or `checkpoint` if it is operator-only.
- `plan-research`: `recipe`, slug `runner-phase-researcher`.
- `plan-approval-gate`: `gate`.
- `execute-slice`: `recipe`, slug `runner-executor`.
- `execute-checkpoint`: `checkpoint`.
- `verify-work`: `recipe`, slug `runner-verifier`.
- `verify-approval-gate`: `gate`.
- `ship-prep`: `recipe`, slug `runner-doc-synthesizer`, or `checkpoint` if docs are operator-owned.
- `ship-approval-gate`: `gate`.

Implementation should choose the smallest honest mapping. If a task is not clearly agent-executable, make it `checkpoint`, not `recipe`.

**Verification:**

```bash
pnpm exec vitest run packages/spine-folder-host/src/tasks/store.test.ts packages/spine-folder-host/src/autopilot/run.test.ts src/__tests__/worked-examples.test.ts
```

---

## Phase W6 — Remove active GSD docs/tests/names

**Objective:** Clean user-facing naming. GSD remains source attribution only.

**Files likely affected:**
- `README.md`
- `SPINE_RESUME_PLAN.md`
- `docs/runner-quest-catalog.md`
- `docs/quests/runner.md` → likely `docs/quests/runner.md`
- `docs/quests/runner-command-map.yaml` → likely `docs/quests/source-command-map.yaml` or `docs/quests/get-shit-done-source-command-map.yaml`
- `docs/quests/runner-command-map.md` → renamed equivalent
- `docs/plans/runner-runner-*` docs → archive/rename or rewrite as source-port history
- `src/__tests__/runner-port.test.ts` → `src/__tests__/runner-catalog.test.ts`
- `src/__tests__/runner-docs.test.ts` → `src/__tests__/runner-docs.test.ts`

**Rules:**
1. Active docs say `runner`, `runner-*`, and “Spine Quest.”
2. Historical docs may say `get-shit-done-cc` only in source attribution sections.
3. No active command examples should use `--quest runner`.
4. No active runtime tests should expect `runner-*` Recipe slugs.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/folder-host-docs.test.ts src/__tests__/worked-examples.test.ts src/__tests__/runner-catalog.test.ts src/__tests__/runner-docs.test.ts
```

---

## Phase W7 — Update H6 smoke to prove the new model

**Objective:** Remove the null/local/null workaround and prove the workflow-node model.

**Files:**
- Modify: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`
- Modify: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`
- Modify: `examples/hermes-operator-adapter/README.md`
- Modify: `docs/plans/runner-hermes-integration-plan.md`

**Expected H6 behavior after cleanup:**
1. `runner init --quest runner`
2. `runner start --quest runner`
3. configure local Hermes Recipe runtime once
4. run autopilot
5. checkpoint nodes complete without Recipe lookup
6. Recipe nodes execute `runner-*` Recipes
7. discussion node still uses `runner-doc-writer`
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

- Canonical Quest command is `runner init --quest runner`.
- Canonical Recipe slugs are `runner-*`.
- No local runtime path falls back to `task.plan_ref` as a Recipe slug.
- Non-agent checkpoints are represented as non-Recipe workflow/task nodes.
- H6 smoke no longer needs the null/local/null workaround.
- GSD appears only as source attribution/history, not active runtime branding.
- `pnpm smoke:folder-host`, `pnpm test`, and `pnpm typecheck` pass.
