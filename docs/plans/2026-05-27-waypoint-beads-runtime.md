# Waypoint Beads Runtime Contract

**Status:** Runtime parity implemented for the folder host, CLI, and Hermes/FirmVault adapter surfaces
**Date:** 2026-05-27
**Beads:** `waypoint-cdn`, `waypoint-beads-ops`

## Goal

Use Beads as a durable graph backend for Waypoint route work without changing
Waypoint's core product boundary.

Waypoint remains the portable runtime language: Quests, Recipes, Routes,
scaffolds, gates, handoffs, artifact policy, and recipe safety semantics.
Beads provides the durable issue graph, dependency readiness, resumability, and
cross-session task memory for a host adapter.

This is a backend contract, not a rebrand. Waypoint should not become Beads,
Mission Control, FirmVault, or GSD. Beads should not absorb Waypoint's catalog
or policy semantics.

## Current Implementation Snapshot

The parity landing keeps `folder` as the default backend and enables `beads`
through explicit host-level selection:

```bash
waypoint init --quest waypoint --backend beads
waypoint init --quest waypoint --backend beads --init-beads
waypoint firmvault bootstrap --cases-root /trusted/FirmVault/Cases --case-name "Jane Smith v. Acme Trucking" --case-type personal-injury --backend beads --init-beads --start --json
```

The Beads backend is now wired through the normal operator surfaces:

- `waypoint start` materializes the route graph as Beads issues and dependencies while preserving a compatibility route record.
- `status`, `routes`, `route`, and `tasks` reconstruct route/task state from Beads issue snapshots.
- `auto` advances ready Beads tasks, blocks on human gates and waits, and enforces recipe side-effect and artifact policy before closing work.
- `gate`, `pause`, `resume`, and `resume --resolve-blocker` mutate the Beads-backed route graph without bypassing human gates.
- `discuss` stores task-scoped discussion messages as Beads comments.
- `route-events` synthesizes route history from route/task comments plus route metadata.
- The Hermes safe command runner allowlists `--backend folder|beads` for `init` and `firmvault bootstrap`, including explicit `--init-beads` case workspace creation, and the FirmVault case bootstrap adapter can start a Beads-backed case through the `paralegal` profile.
- `waypoint init --backend beads --init-beads` provides an explicit real-workspace setup path using `bd init --non-interactive --skip-agents --skip-hooks`.
- `waypoint status --json` exposes `beads.readiness` and Beads root issue ids for operator/Hermes health checks.
- `waypoint start` checks Beads readiness before graph writes and fails with an action hint when `bd` or `.beads/` is missing.
- Smoke coverage includes both deterministic fake-`bd` command-boundary coverage and a real-`bd` temp workspace smoke when `bd` is installed.

The remaining `.waypoint/` files in Beads mode are local host configuration,
manifest copies, compatibility route state, FirmVault product state, and
autopilot run history. The route/task execution graph is Beads-backed.

## Boundary

| Layer | Owns | Does not own |
|---|---|---|
| `@waypoint/core` | Quest/Recipe manifest parsing, route concepts, subject scope, host contracts, safety semantics | Beads CLI calls, Dolt state, filesystem layout, host-specific execution |
| Waypoint host adapter | Backend selection, Beads command/API bridge, metadata encoding, status reconstruction | Catalog semantics, bypassing gates, recipe policy decisions |
| Beads | Durable issues, dependencies, parent/child structure, ready work, notes, history, formulas/molecules where useful | Quest validation, recipe execution policy, artifact verification semantics |
| Recipe runtime | Actual recipe execution, run handles, result reporting | Direct lifecycle mutation, ungated external side effects |

Core runtime code under `src/` must stay host-agnostic. A Beads backend belongs
in a host package or adapter package, likely starting in
`packages/waypoint-folder-host` while the integration is proven.

## Concept Mapping

| Waypoint concept | Beads representation | Notes |
|---|---|---|
| Quest manifest | Formula/proto template or compiler input | The manifest remains source of truth. Formula export is derived. |
| Quest route run | Root epic issue | Carries route-level metadata and the target subject. |
| Workstream/milestone/phase/plan scaffold | Child issue hierarchy or metadata groups | Preserve scaffold refs so status can reconstruct Waypoint progress. |
| Route node | Child issue under the route epic | One issue per executable checkpoint, recipe, gate, wait, discussion, or handoff node. |
| Recipe node | Task issue with `waypoint.recipe_slug` metadata | Beads tracks readiness and status; `IRecipeRuntime` executes. |
| Gate/review node | Blocking issue, optionally mirrored to `bd gate` for async waits | Durable issue state is canonical for route status. |
| Wait node | Blocking task or Beads gate, depending on wait type | Human/route waits should remain durable; short operational timers may use gates. |
| Handoff manifest | Gate/task issue with required artifact metadata | Human review remains explicit. |
| Output artifact requirement | Metadata on the producing task plus verifier transition | Closing the issue is not sufficient if artifacts are missing. |
| Recipe side-effect policy | Metadata and adapter enforcement | `forbidden` and `gated` policies must block or require approval before execution. |
| Route event | Beads note/comment plus optional Waypoint event record | Beads is durable; adapters may keep JSONL events for compatibility during migration. |

## Metadata Contract

Every Beads issue materialized by Waypoint should include a stable metadata
object. The first adapter can write this through `bd create --metadata` and read
it through `bd show --json`.

```json
{
  "waypoint": {
    "schema_version": 1,
    "kind": "route|node|recipe|gate|wait|handoff|artifact",
    "quest_slug": "referral-package",
    "route_id": "route-001",
    "node_key": "medical-chronology",
    "recipe_slug": "firmvault-medical-chronology-update",
    "subject": {
      "type": "project|case|folder|plan",
      "id": "local"
    },
    "scaffold": {
      "workstream": "core",
      "milestone": "v1",
      "phase": "execute",
      "plan_ref": "P8"
    },
    "source": {
      "quest_path": "quests/referral-package.yaml",
      "recipe_path": "recipes/firmvault-medical-chronology-update.yaml"
    },
    "policy": {
      "external_side_effects": "forbidden|gated|none|unspecified",
      "requires_human_review": true
    },
    "artifacts": [
      {
        "path": "referral-package-build/attorney-handoff/START_HERE.html",
        "required": true
      }
    ]
  }
}
```

The adapter may add host-local fields under a different namespace, but it must
not change or reinterpret the `waypoint` namespace without a version bump.

## Dependency Semantics

Beads `blocks` dependencies are the runtime readiness primitive. The compiler
must translate Waypoint ordering into blockers:

- A later wave depends on every prior wave task in the same phase or route
  segment.
- A node with explicit dependencies depends on each prerequisite node.
- A gate blocks downstream nodes until approved or otherwise resolved.
- A wait blocks downstream nodes until its wait condition is satisfied.
- Artifact verifiers block downstream handoffs until required artifacts exist.

Parent/child dependencies are structural only. They should group route, scaffold,
and node issues, but they must not be relied on for readiness.

Discovered implementation work should use Beads `discovered-from` links to the
current issue. It should not be added to Quest manifests unless it changes the
reusable workflow.

## State Mapping

| Beads state | Waypoint route/task meaning |
|---|---|
| `open` and unblocked | `ready` or available for materialization |
| `in_progress` | `running` or claimed by an operator/agent |
| `blocked` or has open blockers | `blocked` or `waiting` |
| `closed` with successful verification | `complete` |
| `closed` without required artifact verification | invalid adapter state |
| deferred | not ready; maps to `waiting` when tied to a timer or external condition |

Waypoint status reconstruction should be derived from Beads issue state and
metadata, not from duplicated hidden state. During migration, folder-host JSONL
route events may remain as an audit compatibility layer, but the Beads-backed
route summary must be reproducible from Beads alone.

## Backend Selection

The folder host keeps folder state as the default route backend. Project config
uses an explicit route backend selector:

```yaml
backend:
  route: folder # or beads
```

`folder` preserves the existing `.waypoint/routes`, `.waypoint/tasks`, and
JSONL event behavior. `beads` selects the Beads route backend for migration and
adapter testing, but it must coexist with installed Quest/Recipe manifests and
the existing recipe runtime config. Switching the selector must not make core
runtime code import Beads APIs, and a host command should only execute Beads
writes through the host adapter boundary.

## Gates, Waits, And Artifacts

Gates are policy, not decoration. A Beads-backed runtime must preserve these
rules:

- Human review gates cannot be auto-closed by recipe success.
- Legal/client communication gates remain human-gated in FirmVault flows.
- External side-effect recipes with `gated` policy require an approval issue or
  gate before execution.
- Recipes with `forbidden` external side effects must not be dispatched to a
  runtime that performs those effects.
- Required artifacts must be checked before closing the producing task or before
  unblocking dependent handoff/QC nodes.

`bd gate` is useful for short-lived operational conditions such as timers, CI,
or external PR status. The canonical Waypoint route gate should initially be a
durable Beads issue with Waypoint metadata so route status survives sync,
compaction, and handoff.

## Build Sequence

1. **Read-only compiler.** Load bundled Quest and Recipe manifests and emit a
   Beads-shaped graph model without mutating `.beads/`.
2. **Formula/proto export.** Convert reusable Quest structures into Beads
   formulas or proto-style templates where the Beads model supports it cleanly.
3. **Direct instantiation.** Materialize a selected Quest route as Beads issues
   with parent/child structure, blockers, metadata, and artifact requirements.
4. **Status reconstruction.** Read the Beads graph back into Waypoint route and
   task summaries.
5. **Recipe execution bridge.** Start recipes through `IRecipeRuntime` from ready
   Beads issues and write run state back to Beads.
6. **Gate/wait/artifact enforcement.** Add explicit approval and artifact
   verification transitions before closing or unblocking issues.
7. **Backend selection.** Add a host-level selector such as `folder` or `beads`
   while keeping folder-host behavior intact.
8. **Parity tests.** Prove the Beads backend preserves the same graph shape,
   gate behavior, and blocked/resume behavior as existing folder-host fixtures.

## Tests And Fixtures

The first implementation tests should be small and compiler-focused:

- Load the current bundled catalog and compile one small Quest plus one larger
  Quest such as `referral-package`.
- Assert recipe nodes keep `recipe_slug`, tools, side-effect policy, and output
  artifact metadata.
- Assert waves and explicit dependencies become Beads `blocks` edges.
- Assert gate and handoff nodes are represented as blockers.
- Assert no Beads CLI command runs in the read-only compiler tests.

Adapter tests should come later, after the compiler model is stable:

- Instantiate a route into a temp `.beads` workspace.
- Verify `bd ready --json` exposes only first-wave work.
- Close or approve prerequisites and verify the next nodes become ready.
- Reconstruct a Waypoint route summary from Beads issue state.

## Non-Goals

- Do not import Beads, Dolt, filesystem, or process APIs into `src/`.
- Do not replace Quest/Recipe manifests with Beads formulas as the source of
  truth.
- Do not make Beads gates the only representation of human route approvals until
  durable route reconstruction is proven.
- Do not migrate existing folder-host state in the first compiler slice.
- Do not auto-execute destructive or external side-effect recipes by default.

## Open Decisions

- Whether the Beads bridge should live permanently in
  `packages/waypoint-folder-host` or graduate into a separate
  `packages/waypoint-beads-host` package.
- Whether formula export should target Beads formulas directly or first use a
  Waypoint-owned intermediate JSON graph.
- Whether operational waits should use `bd gate` immediately or start as durable
  blocker issues with a later gate optimization.

## Resolved Decisions

- Beads-backed route events are reconstructed from route metadata and
  Waypoint-tagged Beads comments. Folder-backed routes continue to use JSONL
  route events.
- Beads-backed task discussion is stored as Waypoint-tagged comments on the
  Beads task issue. Folder-backed task discussion continues to use JSONL
  discussion files.
- FirmVault bootstrap selects the route backend through the same host-level
  backend selector as `waypoint init`.
