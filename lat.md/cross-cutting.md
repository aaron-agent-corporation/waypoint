# Cross-Cutting Concerns
<!-- code-kg:id cross-cutting.overview -->

Cross-cutting concerns are seeded from deterministic import relationships and should be curated as agents verify behavior.

## Candidate Concerns

Use this section for auth, persistence, configuration, background work, observability, and other flows that cross module boundaries.

- packages/waypoint-cli/src/bin.ts (file)
- packages/waypoint-folder-host/src/beads/cli-client.ts (file)
- packages/waypoint-folder-host/src/firmvault/state.ts (file)
- examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts (file)
- packages/waypoint-folder-host/src/catalog/bundled.ts (file)
- src/wizard/types.ts (file)
- src/index.ts (file)
- packages/waypoint-folder-host/src/autopilot/run.ts (file)
- packages/waypoint-folder-host/src/beads/reconstruct.ts (file)
- packages/waypoint-folder-host/src/beads/compiler.ts (file)

## Cross-Community Imports

These imports cross the first-pass directory communities and may indicate integration paths worth documenting.

- src/__tests__/firmvault-quest-skeleton.test.ts imports packages/waypoint-cli/src/bin.ts
- src/wizard/__tests__/organize.test.ts imports packages/waypoint-folder-host/src/firmvault/facts.ts
