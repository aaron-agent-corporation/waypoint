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
├── runner.yaml           # top-level
├── dev/
│   └── bugfix.yaml
└── research/
    └── spike.yaml
```

## Quest sets — the at-a-glance taxonomy

Every quest belongs to exactly one **set**: the external suite it was ported
from, or core. `waypoint quests` groups the menu by set (and,
within GSD, by lifecycle stage) so quests that are used together are shown
together.

| Set | Quests | What it is |
|---|---|---|
| `gsd` | 36 quests (map-codebase, spec-phase, debug, audit-*, …) | The GSD (Get Shit Done) coding workflow library, staged: ideation & context → planning → phase specs & hardening → build & quality loop → milestone close-out → wrap-up & insight. `runner` is its master pipeline. |
| `bmad` | agile-delivery | BMAD-METHOD: one composite agile-delivery quest (analyst/PM/architect/dev/QA ceremonies) |
| `superpowers` | agentic-delivery | Superpowers: one composite delivery quest (brainstorm → subagent dev → TDD → review → finish branch) |
| `gstack` | product-sprint | gstack: founder-led product sprint (think → plan → build → review → test → ship → reflect) |
| `core` | example | Waypoint-native demos and templates |

The set is **derived, not duplicated**: the CLI maps existing port provenance
(`metadata.runner.source_family`, then `metadata.source.project`) to a set, and
a quest with no provenance is `core`. To place a quest explicitly, either add
`Set: <gsd|bmad|superpowers|gstack|core>` to the prose `## Catalog
details` (compiled to `metadata.runner.quest_set`), or put `quest_set` in the
Record block's `metadata.runner` for Record-carrying quests. Explicit
`quest_set` always wins. Derivation and stage ordering live in
`packages/waypoint-cli/src/commands/quest-set.ts`.

## Schema

See `packages/@waypoint-engine/core/src/quests/manifest.ts` for the full type.
Minimum required: `schema_version`, `slug`, `name`, `workflow`.

## Example

See `example.yaml` in this directory for a worked example.

## Beads-ready authoring rules

Waypoint manifests are the source of truth. Beads formulas and Beads issues are
derived runtime artifacts; do not put Beads issue IDs, formula IDs, or backend
state into Quest or Recipe manifests.

Every scaffold plan must declare `metadata.runner.node.type`. Supported node
types are `checkpoint`, `recipe`, `gate`, `wait`, `discussion`, `handoff`, and
`artifact`. A node that should execute a Recipe must use `type: recipe` and set
`metadata.runner.recipe.slug` to a Recipe listed in the Quest's `recipes`.
Non-executable steps must be intentionally typed as checkpoint, gate, wait,
discussion, handoff, or artifact so a Beads backend does not dispatch them.

Gate, wait, handoff, and artifact-producing nodes need structured metadata:

```yaml
metadata:
  runner:
    node:
      type: gate
    gate:
      required: true
      kind: plan_approval
```

```yaml
metadata:
  runner:
    node:
      type: wait
    wait:
      kind: duration_or_landmark
      days: 15
      exit_landmark: records_and_bills_processed
```

```yaml
metadata:
  runner:
    node:
      type: handoff
    handoff:
      kind: attorney_referral_package
      gate_required: true
      gate_ref: attorney-handoff-gate
```

```yaml
metadata:
  runner:
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

Use `required_when` on the same `metadata.runner` object when artifacts or
nodes are conditional. Legal, client, attorney-facing, publishing, deploy, and
other external-action handoffs must remain human-gated with an explicit
`gate_ref`.

Every Recipe must declare:

- `tools`: the required tool capabilities a runtime must support;
- `runtime`: optional runtime hints such as model, temperature, max tokens, or
  host-neutral allowed tools;
- one explicit external side-effect policy at
  `metadata.safety.external_side_effects`,
  `metadata.runner.external_side_effects`, or
  `metadata.source_port.external_side_effects`.

Allowed side-effect values are `forbidden`, `gated`, and `none`. Use `gated`
only when a human approval path is modeled; otherwise keep external side effects
forbidden.

Both execution modes use the same manifests:

```bash
waypoint init --quest runner
waypoint init --quest runner --postgres-no-durable
```

Route/task/event run state lives in the project's postgres schema on the
Console-managed local instance (P5); the pg_durable engine drives execution
by default, and `--postgres-no-durable` opts into the autopilot-driven plain
mode. Quest and Recipe YAML on disk remain the source of truth either way.
(The folder and beads route backends are retired — existing folder projects
move over with `waypoint migrate`.)
