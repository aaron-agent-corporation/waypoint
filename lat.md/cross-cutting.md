# Cross-Cutting Concerns
<!-- code-kg:id cross-cutting.overview -->

Cross-cutting concerns are seeded from deterministic import relationships and should be curated as agents verify behavior.

## Candidate Concerns

Use this section for auth, persistence, configuration, background work, observability, and other flows that cross module boundaries.

- packages/waypoint-folder-host/src/gascity/cli-adapter.ts (file)
- packages/waypoint-cli/src/bin.ts (file)
- packages/waypoint-folder-host/src/beads/cli-client.ts (file)
- packages/waypoint-folder-host/src/firmvault/state.ts (file)
- examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts (file)
- packages/waypoint-folder-host/src/catalog/bundled.ts (file)
- src/wizard/types.ts (file)
- packages/waypoint-folder-host/src/beads/reconstruct.ts (file)
- src/index.ts (file)
- packages/waypoint-folder-host/src/autopilot/run.ts (file)

## Gas City Runtime Over Beads
<!-- code-kg:id cross-cutting.gascity-runtime -->

Gas City runtime over Beads maps no-nudge route-root metadata, explicit
dispatch, and read-only diagnose behavior for Waypoint routes.

Gas City is an optional external execution supervisor layered over
Beads-backed Waypoint routes. Waypoint remains the portable runtime: it owns
Quest parsing, route materialization, gates, read models, and Beads metadata.
Gas City owns city/rig registration, session startup, nudges, and provider
supervision.

Source map:

- `packages/waypoint-cli/src/commands/gascity.ts` exposes operator commands for
  preflight, sling, diagnose, city init, rig add, and status.
- `packages/waypoint-cli/src/commands/start.ts` wires `waypoint start
  --gascity` to the normal Beads route materialization flow.
- `packages/waypoint-folder-host/src/gascity/delegate.ts` orchestrates route
  delegation and records runtime events.
- `packages/waypoint-folder-host/src/gascity/routing.ts` selects the current
  executable Beads task for nudge-enabled dispatch.
- `packages/waypoint-folder-host/src/gascity/metadata.ts` verifies and repairs
  `gc.routed_to` metadata when an explicit policy allows it.
- `packages/waypoint-folder-host/src/gascity/diagnostics.ts` implements
  read-only route diagnostics.
- `packages/waypoint-folder-host/src/gascity/cli-adapter.ts` contains the
  injected `gc` command boundary and converts Gas City state into typed
  diagnostics.
- `scripts/gascity-runtime-smoke.mjs` is the deterministic and opt-in live
  smoke harness.

Observed contract:

- Metadata-only `--gascity-no-nudge` writes `gc.routed_to=<target>` to the
  route root Bead and does not call `gc sling`.
- Explicit dispatch creates a Gas City convoy around the current executable
  Beads task, slings that convoy with `--no-formula --nudge`, and keeps the
  Waypoint route identity on the route root Bead.
- When the previously routed Beads task is closed, route reconstruction treats
  it as done and explicit dispatch can select the next open unblocked
  executable task.
- `scripts/gascity-runtime-smoke.mjs --live-complete` is the opt-in
  end-to-end probe. Live modes first check `live_build_freshness` so source
  changes cannot silently run against stale built package exports. The
  completion probe waits for the routed task to close, records Beads
  notes/comment signals, verifies Waypoint route/task/event readback, and
  dry-runs the next dispatch to prove advancement, route completion, or an
  explicit gate/wait stop. Live temp state is isolated with a temp `GC_HOME`;
  cleanup stops the city, stops the isolated supervisor with `--wait`, verifies
  the supervisor is no longer running, and checks for lingering temp-root
  processes before removing the temp root.
- An open gate or wait at the current node is a hard stop for Gas City
  delegation, even when a later task is open. Operators must resolve gates and
  waits through the Waypoint route/gate commands.
- `waypoint gascity diagnose` reads the latest `route.runtime.delegated` event:
  no-nudge diagnoses the route root, while explicit dispatch diagnoses the
  routed executable task and still reports the route root and dispatch convoy.
- After a Beads claim, Beads is the claim source of truth. A missing
  session-list entry for the assignee is a warning; an inactive matching
  assignee remains a route-scoped stranded-work error.
- Routed work that is open/unassigned but still carries `started_at` and no
  `closed_at` is reported as `gascity-work-claim-released-after-start`; recovery
  remains explicit and non-destructive.
- Unrelated config-drift events and drained background sessions are warning
  context unless they match the routed work target or task assignee.
- Live completion evidence on 2026-05-29 passed repeatedly with Gas City
  version `1.1.1`: routed tasks `wpl-t4x.1`, `wpl-bc9.1`, `wpl-96k.1`,
  cleanup-proof task `wpl-oh8.1`, and no-override global task `wpl-y66.1`
  closed; route readback advanced; and next-dispatch dry-runs selected the
  following executable tasks. `gc` on PATH now resolves to
  `/opt/homebrew/bin/gc` version `1.1.1`; the old `1.1.0` binary is backed up
  at `/opt/homebrew/bin/gc.1.1.0.backup-20260529`.
- Waypoint treats Gas City as an external runtime dependency. The local
  completion-ready `gc` binary is fork-patched from `Whaleylaw/gascity` branch
  `codex/post-claim-completion-reliability` at commit `8cd2efb0`; upstream PR
  `https://github.com/gastownhall/gascity/pull/2737` may remain open without
  blocking Waypoint's fork/patched-binary runtime path.

## Beads Read Models For External Work
<!-- code-kg:id cross-cutting.beads-read-models -->

Beads remains the durable graph for folder-host routes when
`backend.route: beads` is configured. The read models normalize Beads state into
Waypoint route/task/event views without bypassing gates.

Source map:

- `packages/waypoint-folder-host/src/beads/reconstruct.ts` reconstructs
  Waypoint routes from Beads issue snapshots and metadata.
- `packages/waypoint-folder-host/src/routes/read-model.ts` projects Beads route
  progress and task status into route readback.
- `packages/waypoint-folder-host/src/events/read-model.ts` turns Beads comments
  into Waypoint route events.
- `packages/waypoint-cli/src/commands/tasks.ts` exposes normalized task
  readback with raw Beads status/assignee metadata.

Current behavior:

- Closed Beads task issues read back as Waypoint `done` tasks while preserving
  `metadata.beads.status: closed`.
- Beads comments attached to tasks include `payload.task_status` in
  `waypoint route-events`.
- Gate and wait issues are not auto-completed by external comments or task
  completion; route/gate commands must model approvals explicitly.

## Cross-Community Imports

These imports cross the first-pass directory communities and may indicate integration paths worth documenting.

- src/__tests__/firmvault-quest-skeleton.test.ts imports packages/waypoint-cli/src/bin.ts
- src/wizard/__tests__/organize.test.ts imports packages/waypoint-folder-host/src/firmvault/facts.ts
