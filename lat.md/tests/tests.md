# Tests
<!-- code-kg:id tests.tests -->

This section records the test layout discovered during bootstrap and indexes generated test specifications.

## Test Paths

These paths looked test-related during local discovery.

- examples/folder-host-quest/folder-host-quest.test.ts
- examples/hermes-operator-adapter/src/discussion-loop.test.ts
- examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts
- examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts
- examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts
- examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts
- examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts
- examples/hermes-operator-adapter/src/project-registry.test.ts
- examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts
- examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts
- examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts
- examples/host-minimal/src/boundaries.test.ts
- examples/host-minimal/src/host.test.ts
- packages/waypoint-cli/src/cli.test.ts
- packages/waypoint-cli/src/commands/author.test.ts
- packages/waypoint-cli/src/commands/auto.test.ts
- packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts
- packages/waypoint-cli/src/commands/catalog-workspace.test.ts
- packages/waypoint-cli/src/commands/catalog.test.ts
- packages/waypoint-cli/src/commands/discuss.test.ts

## Gas City And Beads Runtime Tests
<!-- code-kg:id tests.gascity-beads-runtime -->

Focused validation for the Gas City runtime and Beads read-model contracts:

- `packages/waypoint-folder-host/src/gascity/cli-adapter.test.ts` covers
  command construction, session/event diagnostics, missing-assignee warnings,
  and route-scoped config-drift behavior.
- `packages/waypoint-folder-host/src/gascity/diagnostics.test.ts` covers
  read-only `waypoint gascity diagnose` behavior, including no-nudge route-root
  diagnosis from `route.runtime.delegated` events and the
  `gascity-work-claim-released-after-start` diagnostic for started work that was
  reopened and unassigned.
- `packages/waypoint-folder-host/src/gascity/delegate.test.ts` covers
  nudge-enabled dispatch, including selecting the next executable task after a
  closed Beads task and stopping at open gates or waits.
- `packages/waypoint-cli/src/commands/gascity.test.ts` covers CLI output and
  error envelopes for the Gas City command surface.
- `packages/waypoint-folder-host/src/routes/read-model.test.ts` covers Beads
  route/task readback, including closed Beads tasks surfacing as Waypoint
  `done` tasks without auto-completing gates.
- `packages/waypoint-folder-host/src/events/read-model.test.ts` covers Beads
  comments as route events, including `payload.task_status`.
- `scripts/gascity-runtime-smoke.mjs` covers fixture-backed Gas City delegation
  plus opt-in live no-nudge, explicit-dispatch, and live completion smokes.
  Live modes also guard against stale built package artifacts before provider
  execution. `--live-complete` checks provider task closure, Beads
  notes/comments, Waypoint route/task/event readback, and next-dispatch dry-run
  behavior. Live temp state uses an isolated `GC_HOME`; cleanup stops the temp
  city and isolated supervisor, asserts the supervisor is no longer running,
  checks for lingering temp-root processes, and retains typed blockers on
  failure. The latest no-override proof used `gc=/opt/homebrew/bin/gc` version
  `1.1.1` and global `waypoint` version `0.1.2`. That `gc` is a
  fork-patched Gas City binary from `Whaleylaw/gascity` commit `8cd2efb0`;
  upstream Gas City PR `https://github.com/gastownhall/gascity/pull/2737`
  remains external to Waypoint.
- A June 1, 2026 local E2E pass under the current Codex account recorded
  `--live-execute` proof at
  `/tmp/waypoint-gascity-e2e-waypoint-n04/06-live-execute-240s-current.json`
  and `--live-complete` proof at
  `/tmp/waypoint-gascity-e2e-waypoint-n04/07-live-complete-420s-current.json`.
  The completion run closed routed Bead `wpl-ksf.1`, read it back through
  Waypoint as `done`, and dry-ran next dispatch to `wpl-ksf.2`.

## Source Test Highlights

These generated highlights come from deterministic file, symbol, and import extraction so agents can search source-shaped concepts before opening raw files.

### examples/folder-host-quest/folder-host-quest.test.ts

Test file `examples/folder-host-quest/folder-host-quest.test.ts` contains tests and validation symbols. Key symbols: `exampleRoot`, `readExampleFile`.

- Symbols: `exampleRoot (const)`, `readExampleFile (function)`
- Imports: none detected
- Imported by: none detected

### examples/hermes-operator-adapter/src/discussion-loop.test.ts

Test file `examples/hermes-operator-adapter/src/discussion-loop.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`, and 4 more.

- Symbols: `repoRoot (const)`, `waypointCli (const)`, `projectRecord (function)`, `startedProject (function)`, `runUnsafeSetupCommand (function)`, `spawnCommand (function)`
- Imports: `examples/hermes-operator-adapter/src/discussion-loop.ts`, `examples/hermes-operator-adapter/src/project-registry.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts

Test file `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`, and 2 more.

- Symbols: `repoRoot (const)`, `waypointCli (const)`, `hermesRuntimeAdapter (const)`, `makeProject (function)`
- Imports: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`, `examples/hermes-operator-adapter/src/project-registry.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts

Test file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`, and 4 more.

- Symbols: `repoRoot (const)`, `waypointCli (const)`, `FakeBdIssue (interface)`, `FakeBdState (interface)`, `installFakeBd (function)`, `fakeBdScript (function)`
- Imports: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts

Test file `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts` contains tests and validation symbols. Key symbols: `waypointCli`, `trustedRegistry`.

- Symbols: `waypointCli (const)`, `trustedRegistry (function)`
- Imports: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts

Test file `examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts` contains tests and validation symbols. Key symbols: none detected.

- Symbols: none detected
- Imports: `examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts

Test file `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts` contains tests and validation symbols. Key symbols: `waypointCli`, `trustedRegistry`.

- Symbols: `waypointCli (const)`, `trustedRegistry (function)`
- Imports: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/project-registry.test.ts

Test file `examples/hermes-operator-adapter/src/project-registry.test.ts` contains tests and validation symbols. Key symbols: none detected.

- Symbols: none detected
- Imports: `examples/hermes-operator-adapter/src/project-registry.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts

Test file `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`, and 1 more.

- Symbols: `repoRoot (const)`, `waypointCli (const)`, `projectRecord (function)`
- Imports: `examples/hermes-operator-adapter/src/project-registry.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: none detected

### examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts

Test file `examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`, and 4 more.

- Symbols: `repoRoot (const)`, `waypointCli (const)`, `makeProject (function)`, `runUnsafeSetupCommand (function)`, `startedBlockedProject (function)`, `spawnCommand (function)`
- Imports: `examples/hermes-operator-adapter/src/project-registry.ts`, `examples/hermes-operator-adapter/src/telegram-gate-loop.ts`
- Imported by: none detected

### examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts

Test file `examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `runtimePath`, and 1 more.

- Symbols: `repoRoot (const)`, `runtimePath (const)`, `runRuntime (function)`
- Imports: none detected
- Imported by: none detected

### examples/host-minimal/src/boundaries.test.ts

Test file `examples/host-minimal/src/boundaries.test.ts` contains tests and validation symbols. Key symbols: none detected.

- Symbols: none detected
- Imports: none detected
- Imported by: none detected

### examples/host-minimal/src/host.test.ts

Test file `examples/host-minimal/src/host.test.ts` contains tests and validation symbols. Key symbols: none detected.

- Symbols: none detected
- Imports: `examples/host-minimal/src/host.ts`
- Imported by: none detected

### packages/waypoint-cli/src/cli.test.ts

Test file `packages/waypoint-cli/src/cli.test.ts` contains tests and validation symbols. Key symbols: `rootPackageVersion`.

- Symbols: `rootPackageVersion (const)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/author.test.ts

Test file `packages/waypoint-cli/src/commands/author.test.ts` contains tests and validation symbols. Key symbols: `makeIo`.

- Symbols: `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/auto.test.ts

Test file `packages/waypoint-cli/src/commands/auto.test.ts` contains tests and validation symbols. Key symbols: `startedProject`, `makeIo`.

- Symbols: `startedProject (function)`, `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts

Test file `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts` contains tests and validation symbols. Key symbols: `realBdSmoke`, `FakeBdIssue`, and 6 more.

- Symbols: `realBdSmoke (const)`, `FakeBdIssue (interface)`, `FakeBdState (interface)`, `silentIo (function)`, `makeIo (function)`, `realBdAvailable (function)`, `installFakeBd (function)`, `fakeBdScript (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/catalog-workspace.test.ts

Test file `packages/waypoint-cli/src/commands/catalog-workspace.test.ts` contains tests and validation symbols. Key symbols: `projectWithAuthoredQuest`.

- Symbols: `projectWithAuthoredQuest (function)`
- Imports: `packages/waypoint-cli/src/commands/quests.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/catalog.test.ts

Test file `packages/waypoint-cli/src/commands/catalog.test.ts` contains tests and validation symbols. Key symbols: `makeIo`.

- Symbols: `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/discuss.test.ts

Test file `packages/waypoint-cli/src/commands/discuss.test.ts` contains tests and validation symbols. Key symbols: `startedProject`, `makeIo`.

- Symbols: `startedProject (function)`, `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/doctor.test.ts

Test file `packages/waypoint-cli/src/commands/doctor.test.ts` contains tests and validation symbols. Key symbols: `tempCaseFolder`, `makeIo`, and 2 more.

- Symbols: `tempCaseFolder (function)`, `makeIo (function)`, `createPath (function)`, `createCompleteMinimalCase (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/firmvault.test.ts

Test file `packages/waypoint-cli/src/commands/firmvault.test.ts` contains tests and validation symbols. Key symbols: `tempProjectRoot`, `captureIo`.

- Symbols: `tempProjectRoot (function)`, `captureIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/gascity.test.ts

Test file `packages/waypoint-cli/src/commands/gascity.test.ts` contains tests and validation symbols. Key symbols: `tempProject`, `makeIo`, and 8 more.

- Symbols: `tempProject (function)`, `makeIo (function)`, `createRecordingClient (function)`, `createMutableIssueReader (function)`, `createRouteIssueReader (function)`, `createMutableRouteIssueReader (function)`, `routeIssues (function)`, `waypointMetadata (function)`, and 2 more
- Imports: `packages/waypoint-cli/src/commands/gascity.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/gate.test.ts

Test file `packages/waypoint-cli/src/commands/gate.test.ts` contains tests and validation symbols. Key symbols: `tempProject`, `startedProject`, and 1 more.

- Symbols: `tempProject (function)`, `startedProject (function)`, `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/handoffs.test.ts

Test file `packages/waypoint-cli/src/commands/handoffs.test.ts` contains tests and validation symbols. Key symbols: `makeIo`.

- Symbols: `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

## Test Coverage Links

Test coverage links map inferred test relationships from test imports to source files so agents can find validation paths.

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` is covered by test imports from `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, and 21 more.

- Tests: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts`, `packages/waypoint-cli/src/commands/catalog.test.ts`, `packages/waypoint-cli/src/commands/discuss.test.ts`, and 17 more

### packages/waypoint-folder-host/src/catalog/bundled.ts

Source file `packages/waypoint-folder-host/src/catalog/bundled.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, and 18 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.test.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/formula.test.ts`, `packages/waypoint-folder-host/src/beads/instantiate.test.ts`, and 14 more

### packages/waypoint-folder-host/src/project/init.ts

Source file `packages/waypoint-folder-host/src/project/init.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, and 14 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/events/read-model.test.ts`, and 10 more

### packages/waypoint-engine-host/src/core/engine-host.ts

Source file `packages/waypoint-engine-host/src/core/engine-host.ts` is covered by test imports from `packages/waypoint-engine-host/src/__tests__/author.test.ts`, `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`, and 13 more.

- Tests: `packages/waypoint-engine-host/src/__tests__/author.test.ts`, `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/gate.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/http-ws.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.beads.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.lifecycle.test.ts`, and 9 more

### packages/waypoint-folder-host/src/beads/instantiate.ts

Source file `packages/waypoint-folder-host/src/beads/instantiate.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, and 11 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/instantiate.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/beads/reconstruct.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, and 7 more

### packages/waypoint-folder-host/src/beads/cli-client.ts

Source file `packages/waypoint-folder-host/src/beads/cli-client.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, and 10 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/beads/workspace.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/read-model.test.ts`, and 6 more

### packages/waypoint-folder-host/src/beads/reconstruct.ts

Source file `packages/waypoint-folder-host/src/beads/reconstruct.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, and 8 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/beads/reconstruct.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/beads/verification.test.ts`, and 4 more

### packages/waypoint-folder-host/src/catalog/install.ts

Source file `packages/waypoint-folder-host/src/catalog/install.ts` is covered by test imports from `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, and 5 more.

- Tests: `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`, `packages/waypoint-folder-host/src/gascity/diagnostics.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, and 1 more

### packages/waypoint-folder-host/src/routes/start.ts

Source file `packages/waypoint-folder-host/src/routes/start.ts` is covered by test imports from `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, and 5 more.

- Tests: `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`, `packages/waypoint-folder-host/src/gascity/diagnostics.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/start.workspace.test.ts`, and 1 more

### packages/waypoint-folder-host/src/routes/store.ts

Source file `packages/waypoint-folder-host/src/routes/store.ts` is covered by test imports from `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 5 more.

- Tests: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/routes/read-model.test.ts`, `packages/waypoint-folder-host/src/routes/start-adhoc.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`, and 1 more

### packages/waypoint-folder-host/src/tasks/store.ts

Source file `packages/waypoint-folder-host/src/tasks/store.ts` is covered by test imports from `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 5 more.

- Tests: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/routes/start-adhoc.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`, and 1 more

### src/wizard/types.ts

Source file `src/wizard/types.ts` is covered by test imports from `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, and 5 more.

- Tests: `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, `src/wizard/__tests__/plan.test.ts`, and 1 more

### packages/waypoint-folder-host/src/events/jsonl.ts

Source file `packages/waypoint-folder-host/src/events/jsonl.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, and 4 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`, `packages/waypoint-folder-host/src/gascity/diagnostics.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`

### packages/waypoint-ui/src/store.ts

Source file `packages/waypoint-ui/src/store.ts` is covered by test imports from `packages/waypoint-ui/src/App.test.tsx`, `packages/waypoint-ui/src/components/AgentChat.test.tsx`, and 4 more.

- Tests: `packages/waypoint-ui/src/App.test.tsx`, `packages/waypoint-ui/src/components/AgentChat.test.tsx`, `packages/waypoint-ui/src/components/RouteGraph.test.tsx`, `packages/waypoint-ui/src/components/RoutesPanel.test.tsx`, `packages/waypoint-ui/src/components/TaskDetail.test.tsx`, `packages/waypoint-ui/src/store.test.ts`

### examples/hermes-operator-adapter/src/project-registry.ts

Source file `examples/hermes-operator-adapter/src/project-registry.ts` is covered by test imports from `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`, and 3 more.

- Tests: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`, `examples/hermes-operator-adapter/src/project-registry.test.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`, `examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts`

### examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts

Source file `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` is covered by test imports from `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, and 3 more.

- Tests: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`

### packages/waypoint-engine-host/src/brain/fake-adapter.ts

Source file `packages/waypoint-engine-host/src/brain/fake-adapter.ts` is covered by test imports from `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, `packages/waypoint-engine-host/src/brain/fake-adapter.test.ts`, and 3 more.

- Tests: `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, `packages/waypoint-engine-host/src/brain/fake-adapter.test.ts`, `packages/waypoint-engine-host/src/core/commands/agent-lifecycle.test.ts`, `packages/waypoint-engine-host/src/core/commands/agent.test.ts`, `packages/waypoint-engine-host/src/core/commands/meta.brain.test.ts`

### packages/waypoint-engine-host/src/types.ts

Source file `packages/waypoint-engine-host/src/types.ts` is covered by test imports from `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, and 3 more.

- Tests: `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, `packages/waypoint-engine-host/src/__tests__/run.folder.test.ts`, `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, `packages/waypoint-engine-host/src/core/event-hub.agent.test.ts`

### packages/waypoint-ui/src/engine/types.ts

Source file `packages/waypoint-ui/src/engine/types.ts` is covered by test imports from `packages/waypoint-ui/src/App.test.tsx`, `packages/waypoint-ui/src/engine/client.integration.test.ts`, and 3 more.

- Tests: `packages/waypoint-ui/src/App.test.tsx`, `packages/waypoint-ui/src/engine/client.integration.test.ts`, `packages/waypoint-ui/src/engine/client.test.ts`, `packages/waypoint-ui/src/graph/build-graph.test.ts`, `packages/waypoint-ui/src/store.test.ts`

### packages/waypoint-folder-host/src/autopilot/run.ts

Source file `packages/waypoint-folder-host/src/autopilot/run.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, and 2 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`

### packages/waypoint-folder-host/src/beads/compiler.ts

Source file `packages/waypoint-folder-host/src/beads/compiler.ts` is covered by test imports from `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.test.ts`, and 2 more.

- Tests: `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.test.ts`, `packages/waypoint-folder-host/src/beads/descriptions.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`

### src/index.ts

Source file `src/index.ts` is covered by test imports from `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, and 2 more.

- Tests: `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, `src/wizard/__tests__/shadow-frontmatter.test.ts`, `src/wizard/__tests__/types.test.ts`

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts

Source file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` is covered by test imports from `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, and 1 more.

- Tests: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`

### packages/waypoint-engine-host/src/brain/pi-version.ts

Source file `packages/waypoint-engine-host/src/brain/pi-version.ts` is covered by test imports from `packages/waypoint-engine-host/src/brain/integration.pi.test.ts`, `packages/waypoint-engine-host/src/brain/pi-version.test.ts`, and 1 more.

- Tests: `packages/waypoint-engine-host/src/brain/integration.pi.test.ts`, `packages/waypoint-engine-host/src/brain/pi-version.test.ts`, `packages/waypoint-engine-host/src/brain/select.test.ts`

### packages/waypoint-engine-host/src/core/event-hub.ts

Source file `packages/waypoint-engine-host/src/core/event-hub.ts` is covered by test imports from `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, and 1 more.

- Tests: `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, `packages/waypoint-engine-host/src/core/event-hub.agent.test.ts`

## Generated Test Specs

These files preserve existing `@lat` backlinks found in test code.

- No generated test-spec files were discovered.
