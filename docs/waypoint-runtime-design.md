# Waypoint Runtime Design

**Status:** Draft v0.1  
**Date:** 2026-05-01  
**Owner:** Mission Control  
**Scope:** Mission Control project lifecycle + Workflow Engine integration

---

## 1. Executive summary

**Waypoint** is Mission Control's lifecycle-and-workflow runtime for moving projects through structured objectives, executable routes, gated checkpoints, recipe dispatch, and autonomous progress loops.

Waypoint is not a clone of GSD. GSD is the historical inspiration and guide. Waypoint is Mission Control-native: it keeps the existing project lifecycle hierarchy as the semantic layer and uses the Workflow Engine as the execution substrate.

The core integration thesis:

> The Waypoint lifecycle owns project intent and progress semantics. The Workflow Engine owns executable routes, dependencies, gates, waits, and recipe materialization.

The current codebase already has both tracks:

1. **GSD lifecycle / hierarchy** — project opt-in lifecycle with workstreams, milestones, phases, plans, task links, gates, and shell lifecycle transitions.
2. **Workflow Engine v1** — executable YAML-defined node graphs with instances, node instances, dependencies, timers, conditions, reviews, gates, recipe tasks, and audit events.

They are parallel today. Waypoint joins them without disrupting existing FirmVault workflow testing.

---

## 2. Naming and vocabulary

### 2.1 System name

- **Waypoint** — the overall Mission Control runtime/module.
- **Waypoint Runtime** — the lifecycle + workflow execution substrate.
- **Waypoint Runtime Design** — this design/contract document.

### 2.2 Runtime terms

| Waypoint term | Existing Mission Control substrate | Meaning |
|---|---|---|
| Waypoint Project | `projects` with lifecycle enabled | A project that can move through structured objectives. |
| Waypoint Track | project `gsd_track` / future renamed lifecycle track | Domain/default lifecycle mode such as product, ops, legal, FirmVault, custom. |
| Waypoint Workstream | `gsd_workstreams` | A parallel lane of project work. |
| Waypoint Milestone | `gsd_milestones` | A major objective or delivery checkpoint. |
| Waypoint Phase | `gsd_phases` | A lifecycle segment within a milestone. |
| Waypoint Plan | `gsd_plans` | A concrete unit of planned work inside a phase. |
| Waypoint Route | `workflow_instances` bound to a Waypoint subject | The executable DAG used to advance a lifecycle entity. |
| Waypoint Node | `workflow_node_instances` | A runtime workflow node. |
| Waypoint Gate | workflow `review`/`gate` node or task gate | A human/agent approval checkpoint. |
| Waypoint Dispatch | workflow recipe node materialization | Creation of Mission Control tasks from route nodes. |
| Waypoint Autopilot | controller over workflow materialization/advancement | Autonomous progress loop. |
| Waypoint Status | aggregate lifecycle + route + task state | Operator-facing map/progress summary. |
| Waypoint Doctor | diagnostic route/controller | Finds broken state and repair suggestions. |
| Waypoint Forensics | post-failure route/controller | Explains what happened after failure/blockage. |

### 2.3 Rename policy

The existing database columns and APIs are still named `gsd_*`. The first Waypoint phase should **not** perform a disruptive rename. Instead:

- keep `gsd_*` schema and REST routes for compatibility;
- add Waypoint-facing docs/UI/API aliases where useful;
- defer physical renames until the integration proves stable.

---

## 3. Existing substrate inventory

### 3.1 Lifecycle / hierarchy substrate

Documented in `docs/agent-gsd-guide.md` and implemented around `src/lib/gsd-hierarchy.ts` plus migration `053_gsd_hierarchy_foundation`.

Existing project shell fields:

| Field | Meaning |
|---|---|
| `projects.gsd_enabled` | Lifecycle machinery enabled for the project. |
| `projects.gsd_track` | Default track/domain. |
| `projects.gsd_phase` | Legacy top-level lifecycle: `discuss -> plan -> execute -> verify -> done`. |
| `projects.gsd_gate_mode` | Gate policy: currently `manual_approval` or `auto_internal`. |
| `projects.gsd_updated_at` | Last lifecycle update timestamp. |

Existing hierarchy tables:

| Table | Current role |
|---|---|
| `gsd_workstreams` | Project-scoped lanes; status `active`, `paused`, `complete`. |
| `gsd_milestones` | Project/workstream objectives; status `planned`, `active`, `complete`, `archived`. |
| `gsd_phases` | Milestone-scoped lifecycle phases; status `planned`, `active`, `complete`, `deferred`. |
| `gsd_plans` | Phase-scoped work plans; status `todo`, `in_progress`, `review`, `done`, `failed`. |

Existing task linkage columns:

- `tasks.gsd_workstream_id`
- `tasks.gsd_milestone_id`
- `tasks.gsd_phase_id`
- `tasks.gsd_plan_id`
- legacy `tasks.gsd_phase`
- task gate fields: `gate_required`, `gate_status`, `gate_approved_by`, `gate_approved_at`

Existing transition helpers:

- `canTransitionGsdLifecycle()` supports linear shell transitions.
- `canTransitionGsdPlanStatus()` supports plan transitions.
- `getBlockingGateTaskIdsForPhase()` and `getBlockingGateTaskIdsForPlan()` enforce task gate blockers.

### 3.2 Workflow Engine substrate

Documented in `docs/workflow-engine-v1.md` and implemented in `src/lib/workflow-engine.ts` plus migrations `063_workflow_engine`, `064_workflow_dependencies`, `065_workflow_dependency_semantics`, and `066_workflow_instance_vars`.

Existing runtime tables:

| Table | Current role |
|---|---|
| `workflow_definitions` | Versioned reusable YAML blueprints. |
| `workflow_instances` | Running copy of a definition against a subject. |
| `workflow_node_instances` | Runtime state for every node in an instance. |
| `workflow_node_dependencies` | Mutable dependency/gate/timer/condition rows. |
| `workflow_events` | Append-only audit trail. |

Existing definition features:

- `schema_version: 1`
- `id`, `name`, `version`, `subject_type`
- `vars` metadata and runtime values
- `triggers`: `manual`, `condition`, `event`, `cooldown`, `cron`
- node types: `recipe`, `review`, `wait`, `code`, `gateway`, `gate`
- dependency types: node, condition, timer
- dependency semantics: `blocks`, `waits_for_all`, `waits_for_any`, `conditional_on_failure`, `related`

Existing engine functions/types include:

- `StartWorkflowInput`
- `MaterializeReadyWorkflowNodesInput`
- `AdvanceWorkflowAfterTaskApprovalInput`
- `AdvanceDueWorkflowTimersInput`
- `SatisfyWorkflowConditionInput`
- instance statuses: `active`, `blocked`, `complete`, `cancelled`, `failed`
- node statuses: `pending`, `ready`, `running`, `waiting`, `blocked`, `complete`, `failed`, `skipped`, `cancelled`

Current Workflow Engine docs already state that workflows can run against any subject: a FirmVault case, a project, a GSD plan, or an ad hoc request. Waypoint makes that promise first-class for lifecycle entities.

---

## 4. Architecture

### 4.1 Layering

```text
Operator / Agent / Hermes / CLI / UI
        |
        v
Waypoint command/API adapter
        |
        v
Waypoint lifecycle model
(project -> workstream -> milestone -> phase -> plan)
        |
        | starts / observes / constrains
        v
Workflow Engine route runtime
(definition -> instance -> node instances -> dependencies -> events)
        |
        | materializes
        v
Mission Control tasks / recipe agents / reviews / gates
        |
        | reports completion, failure, gate state, artifacts
        v
Workflow advancement + lifecycle transitions
```

### 4.2 Ownership rules

| Owner | Owns | Does not own |
|---|---|---|
| Waypoint lifecycle | objective semantics, hierarchy, operator-facing progress, lifecycle transitions | low-level DAG readiness logic |
| Workflow Engine | route graph execution, node readiness, dependency rows, timers, conditions, audit events | project meaning or product semantics |
| Tasks / runner | actual recipe execution, artifacts, logs, worker status | lifecycle state transitions directly |
| Gates/reviews | approval decisions and notes | bypassing lifecycle invariants |
| Autopilot | orchestration loop and safe advancement | destructive/external side effects without approval policy |

### 4.3 Integration principle

Workflow instances should be bound to lifecycle entities by `subject_type` and `subject_id`.

The lifecycle entity remains the semantic source of truth. The workflow instance is the executable route for advancing that entity.

---

## 5. Entity binding contract

### 5.1 Subject types

Waypoint reserves these Workflow Engine subject types:

| Subject type | Subject ID | Meaning |
|---|---|---|
| `waypoint_project` | `projects.id` as string | Route runs against an entire project. |
| `waypoint_workstream` | `gsd_workstreams.id` as string | Route runs against a workstream. |
| `waypoint_milestone` | `gsd_milestones.id` as string | Route runs against a milestone. |
| `waypoint_phase` | `gsd_phases.id` as string | Route runs against a phase. |
| `waypoint_plan` | `gsd_plans.id` as string | Route runs against a plan. |

Compatibility aliases may be accepted during migration:

- `gsd_project`
- `gsd_workstream`
- `gsd_milestone`
- `gsd_phase`
- `gsd_plan`

But new Waypoint definitions should prefer `waypoint_*`.

### 5.2 Workflow instance variables

Every Waypoint route instance should carry enough vars to reconstruct lifecycle scope without extra guessing:

```yaml
vars:
  project_id:
    required: true
    type: number
  workstream_id:
    required: false
    type: number
  milestone_id:
    required: false
    type: number
  phase_id:
    required: false
    type: number
  plan_id:
    required: false
    type: number
  objective:
    required: true
    type: string
  source_platform:
    required: false
    type: string
  source_chat_id:
    required: false
    type: string
  source_thread_id:
    required: false
    type: string
```

Because Workflow Engine variable substitution is metadata-only today, initial route nodes should not depend on template expansion for correctness. Materialization should derive task metadata from `vars_json` and subject binding.

### 5.3 Task materialization metadata

When a Workflow Engine recipe/review node materializes a Mission Control task for a Waypoint route, the task should receive:

| Task field | Source |
|---|---|
| `project_id` | materialization input / route vars |
| `gsd_workstream_id` | route vars or lifecycle parent lookup |
| `gsd_milestone_id` | route vars or lifecycle parent lookup |
| `gsd_phase_id` | route vars or lifecycle parent lookup |
| `gsd_plan_id` | route vars if subject is a plan |
| `workflow_instance_id` | existing workflow linkage |
| `workflow_node_instance_id` | existing workflow linkage |
| `gate_required` | node config/review policy or lifecycle gate mode |
| `gate_status` | `pending` if gate required, otherwise `not_required` |

If the existing tasks table does not yet have direct `workflow_instance_id` / `workflow_node_instance_id` columns, linkage can continue through `workflow_node_instances.task_id` initially. However, Waypoint read models should expose these IDs explicitly.

### 5.4 Route key convention

Use stable workflow keys to make re-entry/idempotency predictable:

```text
waypoint:{subject_type}:{subject_id}:{definition_slug}:v{definition_version}
```

Examples:

```text
waypoint:waypoint_milestone:42:waypoint-milestone-planning:v1
waypoint:waypoint_plan:88:waypoint-plan-execution:v1
```

### 5.5 Task-scoped discussion sessions

Waypoint needs a first-class way for a queued task to initiate and own a live discussion with its assigned agent. Existing task comments are useful for audit and async notes, and currently can relay into project agent sessions, but they are too slow and indirect for deliberate lifecycle phases like intake, discussion, planning clarification, or acceptance review.

The design target is a **task-scoped agent chat session**:

- discussion is opt-in per task, not enabled for every queue item;
- a task can declare `discussion_enabled`/`requires_discussion` through a direct field or task metadata;
- a task can carry a stable `discussion_conversation_id` such as `task:{task_id}:discussion:{agent}`;
- messages remain attached to the task context and can be rendered in the task detail UI;
- the chat session is local to Mission Control/Waypoint by default, rather than forcing the operator back to Telegram/Slack;
- task comments can continue to mirror important discussion turns for audit, but comments should not be the primary interactive transport;
- discussion tasks should be valid Workflow Engine nodes for Waypoint routes, especially `waypoint-project-intake`, `waypoint-milestone-planning`, and review/gate clarification.

This makes the discussion phase a deliberate unit of work in the task queue: the queue item can open a chat, maintain session history, produce a structured discussion summary/artifact, and then unblock the next route node.

---

## 6. State transition contract

### 6.1 Workflow -> lifecycle state mapping

| Workflow state | Lifecycle interpretation | Recommended action |
|---|---|---|
| instance created with ready nodes | entity has an active route | mark corresponding entity active/in_progress if allowed |
| recipe node materialized | concrete work exists | link task to lifecycle IDs |
| recipe task done/approved | node can complete | call workflow advancement |
| review/gate approved | gate satisfied | continue route; maybe transition plan/phase |
| wait node waiting | external/timer wait | status remains active but blocked/waiting in read model |
| instance blocked | unresolved dependency/gate/failure | show blocked state without blindly failing lifecycle entity |
| instance complete | route succeeded | transition lifecycle entity to next semantic state |
| instance failed/cancelled | route did not complete | mark plan failed or phase/milestone blocked based on route policy |

### 6.2 Plan status mapping

| Current `gsd_plans.status` | Waypoint meaning | Workflow interaction |
|---|---|---|
| `todo` | planned but not executing | no active execution route required |
| `in_progress` | actively executing | route instance active/running |
| `review` | awaiting verification/approval | review/gate node active or materialized |
| `done` | accepted complete | route instance complete, acceptance criteria met |
| `failed` | execution failed | route failed or human marked failed |

### 6.3 Phase/milestone status mapping

- A phase can become `active` when its first bound route starts or when its first plan enters `in_progress`.
- A phase can become `complete` when all non-deferred plans are `done` and required gates are approved.
- A milestone can become `active` when any phase is active.
- A milestone can become `complete` when all required phases are complete and milestone verification route passes.
- Existing dependency checks remain authoritative: phase dependencies stay within one milestone; plan dependencies stay within one phase.

### 6.4 Conditions namespace

Waypoint conditions should use a dedicated namespace instead of FirmVault landmarks:

```text
waypoint.project.{project_id}.enabled == true
waypoint.milestone.{milestone_id}.planned == true
waypoint.phase.{phase_id}.ready == true
waypoint.plan.{plan_id}.approved == true
waypoint.plan.{plan_id}.done == true
```

This mirrors FirmVault's condition pattern while keeping domains separate.

---

## 7. Waypoint route definitions

### 7.1 Initial workflow definition set

Add these route definitions under `workflows/`:

| Definition slug | Subject type | Purpose |
|---|---|---|
| `waypoint-project-intake` | `waypoint_project` | Turn a rough objective into lifecycle structure. |
| `waypoint-milestone-planning` | `waypoint_milestone` | Inspect context, draft milestone plan, gate approval. |
| `waypoint-phase-planning` | `waypoint_phase` | Break a phase into executable plans/tasks. |
| `waypoint-plan-execution` | `waypoint_plan` | Execute a plan using coder/debugger/reviewer recipe nodes. |
| `waypoint-phase-verification` | `waypoint_phase` | Verify phase acceptance and transition readiness. |
| `waypoint-milestone-verification` | `waypoint_milestone` | Verify milestone acceptance and close/advance. |
| `waypoint-doctor` | `waypoint_project` | Diagnose inconsistent lifecycle/workflow/task state. |
| `waypoint-forensics` | `waypoint_project` | Explain failure/blockage timeline from events/logs/artifacts. |

### 7.2 Example: plan execution route

```yaml
schema_version: 1
id: waypoint-plan-execution
name: Waypoint Plan Execution
version: 1
subject_type: waypoint_plan

vars:
  project_id:
    required: true
    type: number
  workstream_id:
    required: false
    type: number
  milestone_id:
    required: true
    type: number
  phase_id:
    required: true
    type: number
  plan_id:
    required: true
    type: number
  objective:
    required: true
    type: string

triggers:
  - type: manual

nodes:
  inspect_context:
    type: recipe
    recipe: gsd-researcher
    description: Inspect project context, existing lifecycle graph, repo state, and acceptance criteria.
    config:
      task_goal: Produce a concise context brief for this plan.

  implement_plan:
    type: recipe
    recipe: gsd-coder
    description: Implement the smallest safe change satisfying the active plan.
    depends_on:
      nodes:
        - inspect_context
    config:
      task_goal: Execute the plan with tests and artifacts.

  review_plan:
    type: recipe
    recipe: gsd-reviewer
    description: Review implementation against the plan and acceptance criteria.
    depends_on:
      nodes:
        - implement_plan
    config:
      task_goal: Produce pass/fail review and required fixes.

  human_acceptance_gate:
    type: review
    review:
      mode: human
    depends_on:
      nodes:
        - review_plan
    description: Human/operator acceptance gate before marking the Waypoint plan done.
```

This example intentionally uses existing `gsd-*` recipe slugs as leaf workers until recipe names are renamed or replaced.

---

## 8. Command/API surface

Waypoint should expose a thin adapter over existing lifecycle and workflow APIs.

### 8.1 Commands

| Command | Behavior |
|---|---|
| `/waypoint status` | Summarize lifecycle graph, active route instances, blocked gates, active tasks. |
| `/waypoint enable` | Enable Waypoint lifecycle for a project. |
| `/waypoint intake` | Start/continue project-intake route. |
| `/waypoint plan` | Start planning route for a project/milestone/phase. |
| `/waypoint execute` | Start execution route for a plan. |
| `/waypoint discuss` | Start or resume a task-scoped agent discussion for a Waypoint task. |
| `/waypoint auto` | Run bounded autopilot loop. |
| `/waypoint pause` | Stop materializing new route nodes for scope. |
| `/waypoint resume` | Resume materialization/advancement for scope. |
| `/waypoint doctor` | Start diagnostic route. |
| `/waypoint forensics` | Start forensics route for blocked/failed scope. |

Compatibility aliases can support `/gsd ...` during transition, but user-facing docs should prefer `/waypoint ...`.

### 8.2 API adapter responsibilities

A Waypoint API layer should:

1. resolve project/workstream/milestone/phase/plan scope;
2. verify lifecycle is enabled for the project;
3. select the appropriate route definition;
4. build `subject_type`, `subject_id`, `workflow_key`, and vars;
5. start or reuse a workflow instance idempotently;
6. materialize ready route nodes;
7. return a combined lifecycle + workflow + task status payload.

---

## 9. Autopilot design

Waypoint Autopilot is a bounded controller, not an unrestricted infinite loop.

### 9.1 Loop

```text
1. Load scope: project lifecycle graph + active workflow instances + tasks.
2. Detect ready route nodes and due timers.
3. Materialize ready nodes that pass policy.
4. Observe completed tasks/reviews/gates.
5. Advance workflow nodes and satisfy dependencies.
6. Apply allowed lifecycle transitions.
7. Stop on budget, approval gate, blocker, failure, or no progress.
8. Emit status summary and next required action.
```

### 9.2 Stop conditions

Autopilot must stop when:

- a human gate is pending;
- destructive/external/prod side effect approval is required;
- a workflow instance enters `blocked`, `failed`, or `cancelled`;
- the configured max iterations/budget is reached;
- no node/task/lifecycle state changed in an iteration;
- a recipe reports ambiguous requirements needing operator input.

### 9.3 Safety policies

Hard approval gates should be required for:

- destructive file operations;
- production changes;
- credential creation/rotation/deletion;
- external sends/posts/messages;
- git reset/clean/force push;
- merge/push/PR creation unless explicitly allowed by route policy;
- legal/financial client-facing deliverables without configured review.

---

## 10. Read model

Waypoint status should aggregate these layers:

```json
{
  "project": { "id": 42, "name": "Example", "waypoint_enabled": true },
  "lifecycle": {
    "workstreams": [],
    "milestones": [],
    "active_phase": null,
    "active_plan": null,
    "blocked_gates": []
  },
  "routes": [
    {
      "workflow_instance_id": 123,
      "definition_slug": "waypoint-plan-execution",
      "subject_type": "waypoint_plan",
      "subject_id": "88",
      "status": "active",
      "nodes": []
    }
  ],
  "tasks": {
    "active": [],
    "waiting_on_gate": [],
    "failed": []
  },
  "next_actions": []
}
```

The existing `GET /api/projects/:id/gsd/lifecycle-graph` is the right starting point. It should eventually be either renamed/aliased or wrapped by a Waypoint status endpoint that includes workflow instances/nodes/events.

---

## 11. Migration path

### Phase 1 — Design and compatibility layer

- Keep existing `gsd_*` schema and APIs.
- Add this design doc.
- Add Waypoint terminology in docs/UI where low-risk.
- Define subject types and route key convention.
- Add tests for scope resolution and idempotent route keys before behavior changes.

### Phase 2 — Bind workflow materialization to lifecycle IDs

- Teach `materializeReadyWorkflowNodes()` or a Waypoint wrapper to derive lifecycle IDs from `workflow_instances.vars_json` and `subject_type`.
- Ensure materialized tasks receive `gsd_workstream_id`, `gsd_milestone_id`, `gsd_phase_id`, and `gsd_plan_id`.
- Add tests around route-to-task metadata.

### Phase 3 — Add initial Waypoint route definitions

- Add `waypoint-*` workflow YAML files under `workflows/`.
- Reuse existing `gsd-*` leaf recipes initially.
- Sync definitions through existing workflow registry.
- Add workflow engine tests for route validation and materialization.

### Phase 4 — Add Waypoint status/API adapter

- Add read endpoint aggregating lifecycle graph + route instances + node states + tasks.
- Add start/reuse endpoints for route types.
- Add task-scoped discussion session endpoints for tasks that explicitly enable interactive agent discussion.
- Add CLI wrappers and Hermes/Telegram command adapter.

### Phase 5 — Add bounded Autopilot

- Implement bounded loop over status/materialization/advancement/timers/conditions.
- Enforce stop conditions and approval policies.
- Add Doctor and Forensics routes/controllers.

### Phase 6 — Rename/refine

- Decide whether to physically rename `gsd_*` schema/API fields.
- If renaming, do it through aliases, migration compatibility, and UI copy updates.
- Do not block core integration on physical rename.

---

## 12. Open decisions

1. Should new public REST routes be `/api/waypoint/...` immediately, or should Waypoint be a UI/CLI alias over existing `/api/projects/:id/gsd/...` routes first?
2. Should tasks get direct `workflow_instance_id` and `workflow_node_instance_id` columns, or should the read model join through `workflow_node_instances.task_id` indefinitely?
3. Should route instances be one-per-lifecycle-entity or one-per-operation? Example: one `waypoint_plan` execution route per plan, or separate planning/execution/verification routes per plan.
4. What is the initial default route when a project enables Waypoint: intake, milestone planning, or no route until explicitly started?
5. Should `waypoint_*` condition satisfaction be explicit API calls, derived from lifecycle transitions, or both?
6. How much of the existing `gsd-*` recipe naming should be renamed in the first pass?
7. Should FirmVault workflows stay purely domain-specific, or should FirmVault case workflows optionally create/bind Waypoint lifecycle entities for long-running legal matters?
8. Should task-scoped discussion state live in direct task columns (`discussion_enabled`, `discussion_conversation_id`) or remain in `tasks.metadata` until the model stabilizes?
9. Should discussion messages be mirrored into comments automatically, only summarized into comments, or kept separate except for explicit operator notes?

---

## 13. Immediate next implementation tasks

1. Add `docs/waypoint-runtime-design.md` to the repo. *(This document.)*
2. Create `docs/superpowers/plans/YYYY-MM-DD-waypoint-runtime-integration.md` with a task-by-task implementation plan.
3. Add tests for a `waypoint` scope resolver that maps subject types to project/workstream/milestone/phase/plan IDs.
4. Implement a small `src/lib/waypoint.ts` helper module for:
   - subject type constants;
   - route key generation;
   - lifecycle scope resolution;
   - route vars normalization.
5. Add wrapper tests for materializing a workflow node into a task with lifecycle IDs populated.
6. Add first `workflows/waypoint-plan-execution.yaml` definition and registry validation test.
7. Add a minimal Waypoint status read endpoint or CLI command.

---

## 14. Non-goals for the first implementation pass

- No physical rename of `gsd_*` database columns.
- No full replacement of FirmVault workflows.
- No unrestricted autonomous loop.
- No new workflow templating engine until route vars/materialization needs are proven.
- No destructive/external side-effect automation without explicit gate policy.
