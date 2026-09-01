# Spine: Spine Quest Port

**Status:** plan, not yet executed
**Last updated:** 2026-05-05
**Depends on:** `runner-quests-and-recipes.md`, `spine-folder-host.md`

## Purpose

Port the source CLI (`get-shit-done-cc` / `get-shit-done-main`) into Spine as:

1. **One Quest** — `quests/runner.yaml` — the full discuss → plan → execute → verify → ship lifecycle as a Spine Quest.
2. **A full Recipe library** — one Recipe per GSD agent (33 agents total), stored under `recipes/`. Also port the relevant slash-command orchestration (60+ commands) as Recipe or sub-Quest references where appropriate.

Source of truth for the port: `/Users/aaronwhaley/Downloads/get-shit-done-main/`
- `agents/*.md` — 33 agent prompt files
- `commands/gsd/*.md` — 60+ slash-command definitions

## Scope

### In scope
- Convert every `agents/*.md` file into a `recipes/<slug>.yaml` Recipe manifest in the Spine repo.
- Author `quests/runner.yaml` as a Quest that mirrors GSD's lifecycle: initialize → discuss → plan → execute → verify → ship.
- Map GSD's slash commands to either (a) direct Quest nodes, (b) sub-Quest references, or (c) operator-driven gate/resume actions — whichever fits each command's role.
- Preserve GSD's opinionated autonomous loop so that once initialized, the Quest runs with operator intervention only at discussion phases and gate approvals.

### Out of scope
- Copying GSD's CLI binary, hooks, or npm distribution. We are porting the *content* (prompts, orchestration patterns, lifecycle shape), not the runtime.
- Copying GSD's Claude-Code-specific integration. Our recipes are runtime-backend-agnostic — the Recipe manifest format lets any configured backend execute them.
- GSD's model profile configuration system. Spine already has a runtime config layer; we'll map GSD's model hints into our existing shape.
- GSD's `.planning/*.md` markdown state files as literal files. We'll use Spine's folder-host `.runner/` layout instead (equivalent function, different shape).

## Source inventory

### Agents to port (33)
All from `/Users/aaronwhaley/Downloads/get-shit-done-main/agents/`:

| GSD agent | Proposed Spine Recipe slug |
|---|---|
| runner-advisor-researcher | advisor-researcher |
| runner-ai-researcher | ai-researcher |
| runner-assumptions-analyzer | assumptions-analyzer |
| runner-code-fixer | code-fixer |
| runner-code-reviewer | code-reviewer |
| runner-codebase-mapper | codebase-mapper |
| runner-debug-session-manager | debug-session-manager |
| runner-debugger | debugger |
| runner-doc-classifier | doc-classifier |
| runner-doc-synthesizer | doc-synthesizer |
| runner-doc-verifier | doc-verifier |
| runner-doc-writer | doc-writer |
| runner-domain-researcher | domain-researcher |
| runner-eval-auditor | eval-auditor |
| runner-eval-planner | eval-planner |
| runner-executor | executor |
| runner-framework-selector | framework-selector |
| runner-integration-checker | integration-checker |
| runner-intel-updater | intel-updater |
| runner-nyquist-auditor | nyquist-auditor |
| runner-pattern-mapper | pattern-mapper |
| runner-phase-researcher | phase-researcher |
| runner-plan-checker | plan-checker |
| runner-planner | planner |
| runner-project-researcher | project-researcher |
| runner-research-synthesizer | research-synthesizer |
| runner-roadmapper | roadmapper |
| runner-security-auditor | security-auditor |
| runner-ui-auditor | ui-auditor |
| runner-ui-checker | ui-checker |
| runner-ui-researcher | ui-researcher |
| runner-user-profiler | user-profiler |
| runner-verifier | verifier |

All prefixes drop the `runner-` — Recipes are namespaced under `recipes/` and the Quest context makes ownership clear.

### Commands to map (60+)
From `/Users/aaronwhaley/Downloads/get-shit-done-main/commands/gsd/`. Categorized by target:

**→ Quest phase entrypoints** (these become core phases in `quests/runner.yaml`)
- `new-project.md` → Quest initialization (scaffolding)
- `discuss-phase.md` → `discuss_phase` node (discussion-enabled)
- `plan-phase.md` → `plan_phase` node
- `execute-phase.md` → `execute_phase` node
- `verify-work.md` → `verify_phase` node (review gate)
- `ship.md` → `ship_phase` node

**→ Sub-Quests** (standalone loops invokable from the main Quest or directly)
- `debug.md` → `quests/debug.yaml`
- `spike.md` → `quests/spike.yaml`
- `ui-phase.md` → `quests/ui-phase.yaml`
- `spec-phase.md` → `quests/spec-phase.yaml`
- `secure-phase.md` → `quests/secure-phase.yaml`
- `ai-integration-phase.md` → `quests/ai-integration-phase.yaml`
- `ultraplan-phase.md` → `quests/ultraplan-phase.yaml`
- `validate-phase.md` → `quests/validate-phase.yaml`

**→ Operator actions** (map to existing Spine commands, not new Quest nodes)
- `pause-work.md` → `/runner pause`
- `resume-work.md` → `/runner resume`
- `autonomous.md` → `/runner auto`
- `progress.md` → `/runner status`
- `manager.md` → `/runner routes`

**→ Audit / review sub-Quests** (one-shot Quests that report and exit)
- `audit-fix.md` → `quests/audit-fix.yaml`
- `audit-milestone.md` → `quests/audit-milestone.yaml`
- `audit-uat.md` → `quests/audit-uat.yaml`
- `code-review.md` → `quests/code-review.yaml`
- `eval-review.md` → `quests/eval-review.yaml`
- `ui-review.md` → `quests/ui-review.yaml`
- `review.md` → `quests/review.yaml`
- `review-backlog.md` → `quests/review-backlog.yaml`
- `plan-review-convergence.md` → `quests/plan-review-convergence.yaml`
- `forensics.md` → `quests/forensics.yaml` (already mapped in existing Spine)
- `health.md` → `quests/health.yaml` (already partially mapped)

**→ Utility / inspection Quests** (short one-shots)
- `explore.md` → `quests/explore.yaml`
- `map-codebase.md` → `quests/map-codebase.yaml`
- `stats.md` → `quests/stats.yaml`
- `graphify.md` → `quests/graphify.yaml`
- `extract-learnings.md` → `quests/extract-learnings.yaml`
- `profile-user.md` → `quests/profile-user.yaml`
- `sketch.md` → `quests/sketch.yaml`
- `fast.md` → `quests/fast.yaml` (quick lightweight Quest)
- `quick.md` → `quests/quick.yaml` (quick Quest variant)
- `capture.md` → operator action (add to backlog)
- `inbox.md` → operator action (read backlog)
- `import.md` → operator action (import external artifacts)
- `update.md` → operator action
- `cleanup.md` → maintenance sub-Quest
- `complete-milestone.md` → Quest terminal node action
- `milestone-summary.md` → sub-Quest that reports
- `new-milestone.md` → Quest scaffolding action
- `phase.md` → inspection action
- `workstreams.md` → inspection action
- `workspace.md` → inspection action
- `settings.md` → config action
- `config.md` → config action
- `help.md` → `/runner help`
- `docs-update.md` → sub-Quest
- `ingest-docs.md` → sub-Quest
- `add-tests.md` → sub-Quest
- `pr-branch.md` → sub-Quest
- `thread.md` → discussion-related action
- `undo.md` → operator action (rollback)

**→ Deferred / optional** (skip in first port, reassess later)
- All `ns-*.md` commands — GSD's namespace system. Evaluate after first port lands.

## Architecture of the port

### Directory layout after port

```
runner/                                         (the standalone repo)
├── quests/
│   ├── runner.yaml                                  # main Quest
│   ├── debug.yaml                                # sub-Quest
│   ├── spike.yaml
│   ├── ui-phase.yaml
│   ├── spec-phase.yaml
│   ├── secure-phase.yaml
│   ├── ai-integration-phase.yaml
│   ├── ultraplan-phase.yaml
│   ├── validate-phase.yaml
│   ├── audit-fix.yaml
│   ├── audit-milestone.yaml
│   ├── audit-uat.yaml
│   ├── code-review.yaml
│   ├── eval-review.yaml
│   ├── ui-review.yaml
│   ├── review.yaml
│   ├── review-backlog.yaml
│   ├── plan-review-convergence.yaml
│   ├── explore.yaml
│   ├── map-codebase.yaml
│   ├── stats.yaml
│   ├── graphify.yaml
│   ├── extract-learnings.yaml
│   ├── profile-user.yaml
│   ├── sketch.yaml
│   ├── fast.yaml
│   ├── quick.yaml
│   ├── cleanup.yaml
│   ├── milestone-summary.yaml
│   ├── docs-update.yaml
│   ├── ingest-docs.yaml
│   ├── add-tests.yaml
│   └── pr-branch.yaml
│
├── recipes/
│   ├── advisor-researcher.yaml
│   ├── ai-researcher.yaml
│   ├── assumptions-analyzer.yaml
│   ├── code-fixer.yaml
│   ├── code-reviewer.yaml
│   ├── codebase-mapper.yaml
│   ├── debug-session-manager.yaml
│   ├── debugger.yaml
│   ├── doc-classifier.yaml
│   ├── doc-synthesizer.yaml
│   ├── doc-verifier.yaml
│   ├── doc-writer.yaml
│   ├── domain-researcher.yaml
│   ├── eval-auditor.yaml
│   ├── eval-planner.yaml
│   ├── executor.yaml
│   ├── framework-selector.yaml
│   ├── integration-checker.yaml
│   ├── intel-updater.yaml
│   ├── nyquist-auditor.yaml
│   ├── pattern-mapper.yaml
│   ├── phase-researcher.yaml
│   ├── plan-checker.yaml
│   ├── planner.yaml
│   ├── project-researcher.yaml
│   ├── research-synthesizer.yaml
│   ├── roadmapper.yaml
│   ├── security-auditor.yaml
│   ├── ui-auditor.yaml
│   ├── ui-checker.yaml
│   ├── ui-researcher.yaml
│   ├── user-profiler.yaml
│   └── verifier.yaml
│
└── docs/
    └── quests/
        └── gsd.md                                # operator-facing Quest doc
```

### Shape of the main Quest (`quests/runner.yaml`) — high level

```yaml
schema_version: 1
kind: quest
id: runner
name: Spine
version: 1
description: Opinionated autonomous lifecycle (ported from source CLI).
subject_type: runner_project

scaffolds:
  workstreams: [{ key: core, name: Core }]
  milestones:  [{ key: v1, workstream: core }]
  phases:
    - { key: discover, milestone: v1, order: 10 }
    - { key: plan,     milestone: v1, order: 20 }
    - { key: execute,  milestone: v1, order: 30 }
    - { key: verify,   milestone: v1, order: 40 }
    - { key: ship,     milestone: v1, order: 50 }

nodes:
  # Phase 1: Discovery / discussion
  discuss_objective:
    type: recipe
    recipe: doc-writer
    config:
      runner:
        discussion: { enabled: true, agent: doc-writer }

  project_research:
    type: recipe
    recipe: project-researcher
    depends_on: { nodes: [discuss_objective] }

  domain_research:
    type: recipe
    recipe: domain-researcher
    depends_on: { nodes: [project_research] }

  user_profile:
    type: recipe
    recipe: user-profiler
    depends_on: { nodes: [discuss_objective] }

  assumptions_analysis:
    type: recipe
    recipe: assumptions-analyzer
    depends_on: { nodes: [project_research, domain_research] }

  discover_gate:
    type: review
    review: { mode: human }
    depends_on: { nodes: [assumptions_analysis, user_profile] }

  # Phase 2: Plan
  roadmap:
    type: recipe
    recipe: roadmapper
    depends_on: { nodes: [discover_gate] }

  plan:
    type: recipe
    recipe: planner
    depends_on: { nodes: [roadmap] }

  plan_check:
    type: recipe
    recipe: plan-checker
    depends_on: { nodes: [plan] }

  plan_gate:
    type: review
    review: { mode: human }
    depends_on: { nodes: [plan_check] }

  # Phase 3: Execute
  execute:
    type: recipe
    recipe: executor
    depends_on: { nodes: [plan_gate] }
    config:
      # delegates to sub-recipes (code-fixer, integration-checker, etc.)
      subagents: [code-fixer, integration-checker]

  # Phase 4: Verify
  verify:
    type: recipe
    recipe: verifier
    depends_on: { nodes: [execute] }

  code_review:
    type: recipe
    recipe: code-reviewer
    depends_on: { nodes: [verify] }

  security_audit:
    type: recipe
    recipe: security-auditor
    depends_on: { nodes: [verify] }

  verify_gate:
    type: review
    review: { mode: human }
    depends_on: { nodes: [code_review, security_audit] }

  # Phase 5: Ship
  ship:
    type: recipe
    recipe: executor                              # reuse executor for ship steps
    config:
      subagents: [doc-synthesizer, pr-branch]
    depends_on: { nodes: [verify_gate] }
```

Note: this is a **first-cut shape**. The actual graph may need tweaks after reading each source command file carefully during the port. Treat the above as an informed starting point, not the final spec.

### Shape of a Recipe port — worked example

Source: `/Users/aaronwhaley/Downloads/get-shit-done-main/agents/runner-doc-writer.md`
Target: `recipes/doc-writer.yaml`

```yaml
schema_version: 1
kind: recipe
id: doc-writer
name: Document Writer
version: 1
description: |
  Drafts project documents. Ported from GSD runner-doc-writer agent.
source:
  project: get-shit-done-cc
  file: agents/runner-doc-writer.md
  ported_at: 2026-05-05

runtime:
  supports_discussion: true
  supports_autonomous: true

prompt: |
  [full body of runner-doc-writer.md, verbatim or near-verbatim,
   with GSD-specific references rewritten as Spine references
   where necessary]

tools:
  - file_read
  - file_write
  - search_files
```

The port is **content preservation first, adaptation second**. Goal: if an operator loved GSD's doc-writer, they get the same behavior when running the Spine Quest in Spine.

## Execution plan (phases)

### Phase P0 — Core support
Prerequisite: `runner-quests-and-recipes.md` is implemented. Specifically:
- `@projectrunner/spine` has `QuestManifest` + `RecipeManifest` types, parsers, and registries.
- Registry validation tests exist.

If P0 isn't done, this plan can't execute. Flagged as dependency.

### Phase P1 — Recipe library port (mechanical)
- **P1.1** Write a small port script: read each `agents/runner-*.md`, extract prompt body, produce `recipes/<slug>.yaml` skeleton.
- **P1.2** Manually review each ported Recipe. Fix GSD-specific references (paths, command names) to Spine equivalents.
- **P1.3** Add `recipes/` registry test: parse all 33 recipes, verify zero errors, verify no duplicate IDs.
- **P1.4** Commit library.

### Phase P2 — Main Quest port
- **P2.1** Read `commands/gsd/new-project.md`, `discuss-phase.md`, `plan-phase.md`, `execute-phase.md`, `verify-work.md`, `ship.md`. Extract the orchestration shape from each.
- **P2.2** Draft `quests/runner.yaml` using the high-level shape above, adjusted by what the commands actually do.
- **P2.3** Add Quest parse test: `quests/runner.yaml` parses cleanly, every `recipe:` reference resolves.
- **P2.4** Commit main Quest.

### Phase P3 — Sub-Quest ports
One sub-Quest per command in the "Sub-Quests" category above.
- **P3.1** Port `debug.yaml`, test, commit.
- **P3.2** Port `spike.yaml`, test, commit.
- **P3.3** … continue through the list. One commit per sub-Quest.

Each sub-Quest is a small DAG (usually 3–6 nodes). Test per Quest: parse + recipe-ref resolution.

### Phase P4 — Utility / inspection Quest ports
Same cadence as P3, but for shorter one-shot Quests (explore, stats, graphify, etc.).

### Phase P5 — Command → operator action mapping
For each source command in the "operator actions" category, document the Spine equivalent in `docs/quests/runner.md`. No code changes — this is an operator-facing doc that says "in GSD you ran `/gsd pause-work`; in Spine you run `/runner pause --route-id N`."

### Phase P6 — Integration smoke test
- **P6.1** In the folder-host repo (see `spine-folder-host.md`), add a test fixture that runs `runner init --quest runner` and verifies the scaffolded `.runner/` layout.
- **P6.2** Add a dry-run test that materializes a route from `quests/runner.yaml` and validates the DAG can be traversed (nodes ordered correctly, gates present, recipe refs resolve, no cycles).
- **P6.3** Do **not** execute the Quest against a live backend in this phase. Actual end-to-end execution requires a configured recipe runtime, which is a separate concern.

### Phase P7 — Doc pass
- **P7.1** Write `docs/quests/runner.md` — operator guide: what the Quest does, when to use it, how it compares to the source CLI it was ported from.
- **P7.2** Add attribution: credit the GSD project, link to source, note what was preserved vs adapted.
- **P7.3** Update the standalone `runner` repo README to mention "batteries-included Quest: GSD."

### Phase P8 — Close-out
- **P8.1** Run full test suite. Require green.
- **P8.2** Commit a closure note: "Spine Quest port complete (33 recipes, N Quests, N sub-Quests)."
- **P8.3** Tag a release candidate.

## Acceptance criteria

The port is complete when:

1. All 33 GSD agents exist as parseable `recipes/*.yaml` files in the Spine repo.
2. `quests/runner.yaml` exists, parses cleanly, and every recipe reference resolves.
3. All sub-Quests identified in the "Sub-Quests" category exist as parseable Quest files.
4. Registry tests pass: no duplicate IDs, no unresolved references, no schema violations.
5. Operator-facing doc `docs/quests/runner.md` exists and explains how to adopt the Quest.
6. The Spine folder-host can run `runner init --quest runner` and produce a valid `.runner/` layout (tested via fixture).
7. The Quest DAG passes a structural validation test (no cycles, gates correctly placed, scaffolds valid).

What is *not* required for this plan to be "done":
- Actually executing the Quest end-to-end against a real agent backend (that depends on the recipe runtime adapter and is out of scope here).
- UI for browsing Quests (not a runtime concern).
- Marketplace / multi-source Quest loading (future).

## Risks

1. **Prompt drift.** Verbatim ports may reference GSD-specific files (e.g., `.planning/ROADMAP.md`) that don't exist in Spine. Mitigation: the P1.2 manual review pass. Document any rewrites in the Recipe's `source:` block.

2. **Orchestration pattern mismatch.** GSD uses Claude Code's Task tool semantics. Spine's recipe runtime contract is more abstract. Some subagent patterns may need adjustment. Mitigation: the first sub-Quest we port (probably `debug.yaml`) acts as a proof-of-concept; learnings propagate.

3. **License / attribution.** GSD has a LICENSE file in its repo. We must comply. Mitigation: check the license before merging the port; add attribution in every ported Recipe via the `source:` block; add a top-level `ATTRIBUTION.md` if the license requires it.

4. **Drift over time.** GSD may evolve. Our port is a snapshot. Mitigation: record `ported_at` in each Recipe; document in `docs/quests/runner.md` that this is a point-in-time port, not a live mirror.

5. **Recipe count creep.** Porting 33 agents is real work. Some may turn out to be redundant or better merged. Mitigation: allow consolidation during P1.2 review; document any merges in the port log.

## Dependencies

- **Hard dependency:** `runner-quests-and-recipes.md` must be implemented (Quest + Recipe types, parsers, registries in `@projectrunner/spine`).
- **Soft dependency:** `spine-folder-host.md` — the folder-host CLI is what makes `runner init --quest runner` real. Without it, the Quest can still be parsed and validated, but not instantiated. (Parse/validate is enough for this plan to be "done.")

## Out of scope (explicit)

- Porting GSD's CLI runtime (`bin/`, `sdk/`, hooks, scripts).
- Porting GSD's npm packaging or `package.json`.
- Mirroring GSD's `.planning/*.md` markdown files as literal files.
- Model profile configuration system.
- GSD's test suite (not portable — tests their CLI, not ours).
- Real-time sync with upstream GSD.

## Next step after this plan is approved

Write Phase P0 verification: confirm `runner-quests-and-recipes.md` implementation readiness, then either (a) unblock P0 first, or (b) begin P1.1 with the mechanical port script.
