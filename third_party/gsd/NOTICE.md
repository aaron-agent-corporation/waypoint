# Third-Party Attribution: GSD (get-shit-done-cc)

This directory preserves upstream attribution for portions of
Waypoint's Quest and Recipe library that are derivative works of the
**get-shit-done-cc** project by Lex Christopherson.

- Upstream project: https://www.npmjs.com/package/get-shit-done-cc
- Upstream source snapshot: `/Users/aaronwhaley/Downloads/get-shit-done-main/`
  (local reference archive — not redistributed in this repo)
- License: MIT (see `LICENSE` in this directory)
- Copyright: © 2025 Lex Christopherson

## What is derived from GSD

The following Waypoint artifacts are translations/adaptations of GSD
prompts and command definitions, not verbatim copies:

- `recipes/*.yaml` entries whose `metadata.port.source_kind: gsd-agent`
  — these are Recipe manifests whose `prompt:` field is derived from a
  corresponding `agents/gsd-*.md` file in the upstream project.
- `quests/gsd.yaml` — a Quest manifest whose structure mirrors the
  upstream GSD lifecycle loop (new-project → discuss-phase →
  plan-phase → execute-phase → verify-work → ship).

Every derived Recipe manifest carries a `metadata.port` block that
records:

- `source_kind` — `gsd-agent` or `gsd-command`
- `source_path` — the upstream file path (e.g. `agents/gsd-doc-writer.md`)
- `source_commit` — upstream commit SHA at time of port, when known
- `port_notes` — any deliberate deviations from the upstream prompt

## What is NOT derived from GSD

- `@waypoint/core` — original work. No GSD code was ported.
- `packages/waypoint-core/**` — original.
- `examples/**` — original.
- `docs/**` — original (though plans may reference GSD by name).

## MIT compliance

Per MIT license terms, we retain:

1. The upstream copyright notice (see `LICENSE` in this directory).
2. The MIT permission text in full.
3. A pointer back to the upstream project (above).

When redistributing Waypoint in a form that includes derived Recipe or
Quest manifests, downstream consumers MUST preserve this NOTICE file
and the adjacent `LICENSE`.

## Adding a new derived artifact

When porting a new GSD agent or command:

1. Create the Recipe/Quest manifest as a new-work YAML file.
2. Add the `metadata.port` block pointing at the upstream source.
3. Update `docs/plans/waypoint-gsd-port-status.md` (the port tracking
   doc) with a checkmark for the new entry.
