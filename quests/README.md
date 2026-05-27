# Example Quests

A **Quest** is a reusable, named workflow template — the journey a project takes
from intake to ship. Each file in this directory is one Quest manifest.

Quest manifests reference recipes by slug. The referenced recipes must exist in
the `recipes/` directory when a Quest is loaded into a runtime.

## Layout

The loader (`loadQuestsFromDirectory`) walks this directory **recursively**, so
you can organize Quests into subdirectories however you want:

```
quests/
├── waypoint.yaml           # top-level
├── dev/
│   └── bugfix.yaml
└── research/
    └── spike.yaml
```

## Schema

See `packages/@waypoint/core/src/quests/manifest.ts` for the full type.
Minimum required: `schema_version`, `slug`, `name`, `workflow`.

## Example

See `example.yaml` in this directory for a worked example.

## Beads-ready authoring rules

Waypoint manifests are the source of truth. Beads formulas and Beads issues are
derived runtime artifacts; do not put Beads issue IDs, formula IDs, or backend
state into Quest or Recipe manifests.

Every scaffold plan must declare `metadata.waypoint.node.type`. Supported node
types are `checkpoint`, `recipe`, `gate`, `wait`, `discussion`, `handoff`, and
`artifact`. A node that should execute a Recipe must use `type: recipe` and set
`metadata.waypoint.recipe.slug` to a Recipe listed in the Quest's `recipes`.
Non-executable steps must be intentionally typed as checkpoint, gate, wait,
discussion, handoff, or artifact so a Beads backend does not dispatch them.

Gate, wait, handoff, and artifact-producing nodes need structured metadata:

```yaml
metadata:
  waypoint:
    node:
      type: gate
    gate:
      required: true
      kind: plan_approval
```

```yaml
metadata:
  waypoint:
    node:
      type: wait
    wait:
      kind: duration_or_landmark
      days: 15
      exit_landmark: records_and_bills_processed
```

```yaml
metadata:
  waypoint:
    node:
      type: handoff
    handoff:
      kind: attorney_referral_package
      gate_required: true
      gate_ref: attorney-handoff-gate
```

```yaml
metadata:
  waypoint:
    node:
      type: recipe
    recipe:
      slug: referral-package-start-here-builder
    output_artifacts:
      - referral-package-build/attorney-handoff/START_HERE.html
    artifact_verifier:
      kind: required_paths
      checks:
        - exists
        - non_empty
```

Use `required_when` on the same `metadata.waypoint` object when artifacts or
nodes are conditional. Legal, client, attorney-facing, publishing, deploy, and
other external-action handoffs must remain human-gated with an explicit
`gate_ref`.

Every Recipe must declare:

- `tools`: the required tool capabilities a runtime must support;
- `runtime`: optional runtime hints such as model, temperature, max tokens, or
  host-neutral allowed tools;
- one explicit external side-effect policy at
  `metadata.safety.external_side_effects`,
  `metadata.waypoint.external_side_effects`, or
  `metadata.source_port.external_side_effects`.

Allowed side-effect values are `forbidden`, `gated`, and `none`. Use `gated`
only when a human approval path is modeled; otherwise keep external side effects
forbidden.

The folder backend and Beads backend use the same manifests:

```bash
waypoint init --quest waypoint --backend folder
waypoint init --quest waypoint --backend beads
```

`folder` stores route/task state in `.waypoint/`. `beads` materializes the same
Quest route as Beads issues with Waypoint metadata, dependencies, gates, waits,
artifacts, and Recipe policy attached.
