# Waypoint: Quests and Recipes

**Status:** design, not yet implemented
**Last updated:** 2026-05-05

## Purpose

This document defines the two core first-class concepts in Waypoint going forward:

1. **Quest** — a named, reusable workflow template. A Quest defines the full journey a project takes (e.g., discuss → plan → execute → verify → ship). Quests are the unit a project picks when it adopts Waypoint.
2. **Recipe** — a named, reusable agent definition. A Recipe packages an agent's prompt and orchestration pattern into a standalone artifact that any Quest node can reference by slug.

Quests compose Recipes. Projects adopt Quests. The runtime (`@waypoint/core`) executes the DAG a Quest defines, dispatching to Recipes at each node.

## Rationale

Previously the word "lifecycle" was used to describe what's now called a Quest. That was imprecise — it conflated *the journey* (what stages happen, in what order, with what gates) with *the infrastructure* (workstreams/milestones/phases/plans rows). We now draw the line clearly:

- **Quest** = the journey template (reusable, versioned, shippable)
- **Lifecycle skeleton** (workstream/milestone/phase/plan) = what a Quest *generates* when instantiated on a project
- **Workflow** (YAML DAG) = the underlying mechanism Quests are authored in
- **Route** = a live execution instance of a Quest on a specific project entity

"Workflow" remains a valid internal term — it's the syntax. "Quest" is the user-facing name for a curated, named workflow that ships as a template.

## Terminology

| Term | Meaning | User-facing? |
|---|---|---|
| **Quest** | A named, reusable workflow template. Owns a complete journey. | ✅ yes |
| **Recipe** | A named, reusable agent definition (prompt + orchestration). | ✅ yes |
| **Workflow** | The YAML DAG syntax Quests are written in. | internal |
| **Route** | A live execution of a Quest against a project entity. | ✅ yes |
| **Lifecycle skeleton** | The workstream/milestone/phase/plan rows a Quest generates. | internal |

The `gsd_*` prefix is retired in all new naming. Tables and types that used `gsd_*` are renamed to `waypoint_*` (tracked in the remaining-roadmap doc).

## Folder layout

A Waypoint installation (whether MC-hosted or folder-hosted) exposes:

```
waypoint/
├── quests/
│   ├── waypoint.yaml                    # the GSD lifecycle as a Quest
│   ├── bugfix.yaml                 # short-loop bugfix Quest (future)
│   ├── research-spike.yaml         # research-only Quest (future)
│   └── content-publish.yaml        # content pipeline Quest (future)
│
├── recipes/
│   ├── doc-writer.yaml             # ported from waypoint-doc-writer
│   ├── planner.yaml                # ported from waypoint-planner
│   ├── executor.yaml               # ported from waypoint-executor
│   ├── verifier.yaml               # ported from waypoint-verifier
│   ├── debugger.yaml               # ported from waypoint-debugger
│   └── ... (one per ported agent)
│
└── templates/                      # optional: per-Quest project templates
    └── gsd/
        └── .waypoint/              # pre-populated state files
```

In folder-host mode, this layout lives under `.waypoint/` at the project root. In MC-hosted mode, it lives in the MC repo (`workflows/`, plus a new `recipes/` directory).

## Quest manifest format

A Quest is a YAML workflow definition with Quest-level metadata at the top.

```yaml
schema_version: 1
kind: quest
id: waypoint
name: Waypoint
version: 1
description: |
  Opinionated lifecycle: initialize → discuss → plan → execute → verify → ship.
  Based on the source CLI by @your-source.

# what subject type this Quest produces a route for
subject_type: waypoint_project

# what lifecycle skeleton this Quest generates when instantiated
scaffolds:
  workstreams:
    - key: core
      name: Core workstream
  milestones:
    - key: v1
      workstream: core
  phases:
    - key: discover
      milestone: v1
      order: 10
    - key: plan
      milestone: v1
      order: 20
    - key: execute
      milestone: v1
      order: 30
    - key: verify
      milestone: v1
      order: 40
    - key: ship
      milestone: v1
      order: 50

# variables required when a project adopts this Quest
vars:
  project_id:
    required: true
    type: number
  workspace_id:
    required: true
    type: number

# the DAG itself
nodes:
  discuss_objective:
    type: recipe
    recipe: doc-writer            # references recipes/doc-writer.yaml
    config:
      waypoint:
        discussion:
          enabled: true
          agent: doc-writer
          prompt: |
            Discuss the project objective and acceptance criteria with the operator.

  draft_requirements:
    type: recipe
    recipe: planner
    depends_on:
      nodes: [discuss_objective]

  requirements_gate:
    type: review
    review:
      mode: human
    depends_on:
      nodes: [draft_requirements]

  plan_phase:
    type: recipe
    recipe: roadmapper
    depends_on:
      nodes: [requirements_gate]

  plan_gate:
    type: review
    review:
      mode: human
    depends_on:
      nodes: [plan_phase]

  execute_phase:
    type: recipe
    recipe: executor
    depends_on:
      nodes: [plan_gate]

  verify_phase:
    type: recipe
    recipe: verifier
    depends_on:
      nodes: [execute_phase]

  ship_phase:
    type: recipe
    recipe: shipper
    depends_on:
      nodes: [verify_phase]
```

## Recipe manifest format

A Recipe packages what used to live in a GSD `agents/*.md` file. It is a standalone artifact; any Quest can reference it by slug.

```yaml
schema_version: 1
kind: recipe
id: doc-writer
name: Document Writer
version: 1
description: |
  Drafts project documents (requirements, specs, READMEs). Asks clarifying
  questions when inputs are ambiguous.

# model + runtime hints
runtime:
  default_model: claude-sonnet-4
  supports_discussion: true
  supports_autonomous: true

# the agent's system prompt
prompt: |
  You are a document writer for the Waypoint Waypoint Quest. Your job is to draft
  project documentation based on operator input.

  Rules:
  1. If inputs are ambiguous, ask one targeted question at a time.
  2. Write in the repo's existing voice if prior docs exist.
  3. Never invent facts — if a fact is unknown, mark it as TBD.
  4. When done, produce a single coherent markdown document.

  [... full prompt body, ported from waypoint-doc-writer.md ...]

# tools this recipe is allowed to use
tools:
  - file_read
  - file_write
  - search_files

# what inputs this recipe expects
inputs:
  project_id: number
  phase_id: number
  objective: string

# what this recipe promises to produce
outputs:
  document_path: string
  status: enum[complete, needs_clarification]

# optional: subagents this recipe orchestrates
subagents:
  - doc-classifier          # references recipes/doc-classifier.yaml
  - doc-verifier
```

A Quest node that uses this recipe:

```yaml
draft_requirements:
  type: recipe
  recipe: doc-writer            # resolved against recipes/ directory
  inputs:
    objective: "{{ route.context.objective }}"
```

## How Quests compose Recipes

1. At **Quest parse time**, every `recipe:` reference is resolved against the `recipes/` registry.
2. At **route start**, the Quest's DAG is materialized into a workflow instance. Each recipe node carries a pointer to its Recipe manifest.
3. At **node execution time**, the recipe runtime (`IRecipeRuntime` implementation) loads the Recipe's prompt + config and dispatches to the configured agent backend (Hermes, Claude Code, Codex, a local LLM, whatever the host provides).

Recipes are **runtime-backend-agnostic** — the Recipe says "here's the prompt and expected shape," the runtime adapter decides how to actually invoke an agent.

## How a project adopts a Quest

```
waypoint init --quest waypoint
```

This:
1. Reads `quests/waypoint.yaml`
2. Scaffolds the lifecycle skeleton in the project (workstream → milestone → phases) per the Quest's `scaffolds:` block
3. Writes project-local state to `.waypoint/` (folder-host) or DB rows (MC-host)
4. Sets the project's default Quest to `waypoint`

Later:

```
waypoint start --quest waypoint
```

Starts a route against the scaffolded plan(s), which drives execution through the DAG.

Projects can also adopt multiple Quests (e.g., a long-running `waypoint` Quest for main development plus ad-hoc `bugfix` Quests that run on-demand).

## Core contract additions

To formalize this, `@waypoint/core` gets:

- `packages/waypoint-core/src/quests/quest-manifest.ts`
  - Types: `QuestManifest`, `QuestScaffold`, `QuestNode`
  - Parser: `parseQuestManifest(yaml: string): QuestManifest`
  - Validator: rejects malformed manifests, unresolved recipe refs
- `packages/waypoint-core/src/recipes/recipe-manifest.ts`
  - Types: `RecipeManifest`, `RecipeRuntime`, `RecipeIO`
  - Parser: `parseRecipeManifest(yaml: string): RecipeManifest`
- `packages/waypoint-core/src/quests/registry.ts`
  - `QuestRegistry` + `RecipeRegistry` — resolve-by-slug, with validation that every `recipe:` reference in a Quest exists in the registry

All additions TDD-first. No runtime behavior change in MC until these are consumed.

## Migration path from current state

The existing `workflows/waypoint-plan-execution.yaml` etc. stay valid — they're just workflow definitions, unchanged. What's new is:

1. **New `quests/` directory** alongside `workflows/`. Quest = workflow with Quest-level metadata at top. Over time, shippable workflows become Quests; one-off internal workflows stay in `workflows/`.
2. **New `recipes/` directory**. Agent prompts move here as standalone manifests. Quests reference them by slug instead of inlining prompts.
3. **DB/folder rename `gsd_*` → `waypoint_*`** (tracked in the roadmap doc; mechanical rename, not conceptual change).

## Out of scope for this doc

- Exact port of GSD's 33 agents → that's in `waypoint-waypoint-quest-port.md`.
- Folder-host CLI wiring → that's in `waypoint-folder-host.md`.
- Recipe runtime backend adapters (Hermes, Claude Code, etc.) → a separate plan.

## Definition of done (for this concept)

This plan is "complete" when:

1. `QuestManifest` and `RecipeManifest` types + parsers exist in `@waypoint/core`.
2. A `quests/waypoint.yaml` and at least one `recipes/*.yaml` exist and parse cleanly.
3. Core contract tests prove registry resolution works (Quest references valid recipe → ok; Quest references missing recipe → error).
4. The `waypoint-lifecycle-workflow` port plan (`waypoint-waypoint-quest-port.md`) is authored and can begin execution.

None of those are done yet. This doc is the design.
