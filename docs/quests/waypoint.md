# Project Delivery (GSD) Quest Operator Guide

The `waypoint` Quest is the batteries-included Project Delivery (GSD) Quest port of the get-shit-done-cc working loop. It preserves the useful shape of the old GSD flow while moving the implementation into Waypoint primitives.

Waypoint is the runtime. GSD is source material for this bundled Quest and Recipe library, not the product name.

## What the Project Delivery (GSD) Quest does

The main Quest lives at `quests/waypoint.yaml` and models the journey:

initialize → discuss → plan → execute → verify → ship

A Quest is the user-facing journey template. In this repo, the Quest manifest names the workflow substrate, lists the Recipes it can use, and carries scaffold metadata for the workstream / milestone / phase / plan structure a host can materialize.

A Recipe is the reusable agent definition. Recipes live under `recipes/waypoint/` and preserve ported agent prompt content and orchestration intent from the source GSD agent library. The Quest does not hard-code an agent runtime; a host decides how to invoke a Recipe through its `IRecipeRuntime` adapter.

## How the old GSD concepts map to Waypoint

- Source lifecycle commands become the main `waypoint` Quest phase metadata.
  - `commands/gsd/new-project.md` → initialize
  - `commands/gsd/discuss-phase.md` → discuss
  - `commands/gsd/plan-phase.md` → plan
  - `commands/gsd/execute-phase.md` → execute
  - `commands/gsd/verify-work.md` → verify
  - `commands/gsd/ship.md` → ship
- Standalone old source commands become separate Quest manifests when they describe a reusable journey, for example `quests/debug.yaml`, `quests/spike.yaml`, `quests/code-review.yaml`, and `quests/pr-branch.yaml`.
- Old operational commands become Waypoint operator actions where the runtime already has an equivalent command surface, for example `/waypoint pause`, `/waypoint resume`, `/waypoint auto`, `/waypoint status`, `/waypoint routes`, and `/waypoint help`.
- Optional namespace commands are deferred until Waypoint has first-class namespace/context semantics.

The full command mapping is in `docs/quests/waypoint-command-map.md`; the machine-readable source of that map is `docs/quests/waypoint-command-map.yaml`.

## What was preserved

- The six-step delivery loop: initialize → discuss → plan → execute → verify → ship.
- The idea that deliberate discussion and planning happen before execution.
- Agent-specialized prompts, ported into namespaced `waypoint-*` Recipes.
- Review, audit, debugging, research, documentation, and shipping helper flows as standalone catalog Quests.
- Operator control points: the human still decides when plans are accepted, verification passes, and shipping is allowed.

## What was adapted

- The old command surface is not copied as a CLI. It is translated into Waypoint Quest manifests, Recipe manifests, and operator-action mappings.
- Sub-Quest composition is currently represented as explicit metadata because the current `QuestManifest` schema does not have a first-class sub-Quest reference field.
- Workflow execution remains a host responsibility. This standalone repo supplies portable core contracts, manifests, loaders, resolvers, and tests; it does not embed Mission Control's full UI or database adapter.
- GSD names remain on the ported Quest and Recipes for source traceability, but Waypoint remains the runtime identity.

## Humans intervene

The default operator path concentrates human involvement at deliberate discussion and gate moments instead of requiring constant chat noise.

- Initialize: the operator provides project context, constraints, and preferences.
- Discuss: the Quest can open a task-scoped discussion with `waypoint-doc-writer` to clarify objective and acceptance criteria.
- Plan: the plan approval gate blocks execution until the human accepts the proposed plan.
- Execute: Recipes can work autonomously or in slices, with optional checkpoints and evidence capture.
- Verify: the verification gate lets the human accept, reject, or send work back for fixes.
- Ship: the ship approval gate is the final human release decision.

The main manifest records these points under scaffold metadata:

- task-scoped discussion: `discuss-objective`
- plan approval gate: `plan-approval-gate`
- verification gate: `verify-approval-gate`
- ship approval gate: `ship-approval-gate`

## How Recipes are used by Quest nodes

Current Quest manifests list Recipe slugs under `recipes:` and carry phase/source-command intent under `metadata.source_port`. Structural tests verify every listed Recipe resolves through the Recipe registry.

Representative phase Recipes:

- Initialize: `waypoint-doc-writer`, `waypoint-project-researcher`, `waypoint-roadmapper`
- Discuss: `waypoint-assumptions-analyzer`, `waypoint-codebase-mapper`, `waypoint-doc-writer`
- Plan: `waypoint-phase-researcher`, `waypoint-planner`, `waypoint-plan-checker`
- Execute: `waypoint-executor`
- Verify: `waypoint-verifier`, `waypoint-debugger`, `waypoint-plan-checker`
- Ship: `waypoint-doc-synthesizer`, `waypoint-code-reviewer`, `waypoint-executor`

## Operator workflow

A host that adopts this Quest should present it as a Waypoint journey, not as a legacy source command clone.

1. Load Quests from `quests/` and Recipes from `recipes/`.
2. Choose the `waypoint` Quest.
3. Materialize its scaffold into the host's project/folder/work item model.
4. Start the initialize phase and collect project context.
5. Open the task-scoped discussion when the discuss checkpoint is reached.
6. Generate and review the plan.
7. Approve the plan gate before execution begins.
8. Run execution slices with Recipe-backed agents.
9. Run verification and resolve defects.
10. Approve the ship gate and hand off or release.

## What is not implemented yet

This P6 documentation intentionally does not claim runtime behavior that is not in the standalone repo yet.

- It does not implement a standalone source CLI.
- It does not implement a full folder-host command runner.
- It does not implement first-class sub-Quest references in the Quest schema.
- It does not implement a built-in agent executor; hosts provide Recipe execution through adapters.
- It does not implement namespace commands such as `ns-project` or `ns-workflow`.
- It does not implement Mission Control UI screens in this extracted repo.

Those are future runtime or host-adapter tracks. Track 4's current scope is the portable Quest/Recipe catalog, command mapping, and structural validation.

## Verification status

As of P6, the Waypoint source port has:

- 33 namespaced Waypoint Recipes under `recipes/waypoint/`.
- 1 main Project Delivery (GSD) Quest under `quests/waypoint.yaml`.
- 35 command-informed/catalog Quest manifests plus the existing example Quest.
- 65 upstream command mappings in `docs/quests/waypoint-command-map.yaml`.
- Structural smoke coverage in `src/__tests__/waypoint-port.test.ts`.
- Operator documentation coverage in `src/__tests__/waypoint-docs.test.ts`.
