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
- packages/waypoint-cli/src/commands/catalog.test.ts
- packages/waypoint-cli/src/commands/discuss.test.ts
- packages/waypoint-cli/src/commands/doctor.test.ts
- packages/waypoint-cli/src/commands/firmvault.test.ts

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
  `1.1.1` and global `waypoint` version `0.1.2`.

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

Test file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts` contains tests and validation symbols. Key symbols: `repoRoot`, `waypointCli`.

- Symbols: `repoRoot (const)`, `waypointCli (const)`
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

### packages/waypoint-cli/src/commands/init-status.test.ts

Test file `packages/waypoint-cli/src/commands/init-status.test.ts` contains tests and validation symbols. Key symbols: `tempProject`.

- Symbols: `tempProject (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/lifecycle.test.ts

Test file `packages/waypoint-cli/src/commands/lifecycle.test.ts` contains tests and validation symbols. Key symbols: `tempProject`, `makeIo`.

- Symbols: `tempProject (function)`, `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

### packages/waypoint-cli/src/commands/operators.test.ts

Test file `packages/waypoint-cli/src/commands/operators.test.ts` contains tests and validation symbols. Key symbols: `makeIo`.

- Symbols: `makeIo (function)`
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: none detected

## Test Coverage Links

Test coverage links map inferred test relationships from test imports to source files so agents can find validation paths.

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` is covered by test imports from `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, and 20 more.

- Tests: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/catalog.test.ts`, `packages/waypoint-cli/src/commands/discuss.test.ts`, `packages/waypoint-cli/src/commands/doctor.test.ts`, and 16 more

### packages/waypoint-folder-host/src/project/init.ts

Source file `packages/waypoint-folder-host/src/project/init.ts` is covered by test imports from `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, and 6 more.

- Tests: `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/lifecycle/store.test.ts`, `packages/waypoint-folder-host/src/project/init.test.ts`, `packages/waypoint-folder-host/src/project/status.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, and 2 more

### src/wizard/types.ts

Source file `src/wizard/types.ts` is covered by test imports from `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, and 5 more.

- Tests: `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, `src/wizard/__tests__/plan.test.ts`, and 1 more

### examples/hermes-operator-adapter/src/project-registry.ts

Source file `examples/hermes-operator-adapter/src/project-registry.ts` is covered by test imports from `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`, and 3 more.

- Tests: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`, `examples/hermes-operator-adapter/src/project-registry.test.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`, `examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts`

### examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts

Source file `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` is covered by discussion-loop, firmvault-case-bootstrap, and 3 more test imports.

- Tests: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`

### packages/waypoint-folder-host/src/routes/store.ts

Source file `packages/waypoint-folder-host/src/routes/store.ts` is covered by test imports from `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 3 more.

- Tests: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`, `packages/waypoint-folder-host/src/routes/store.test.ts`

### packages/waypoint-folder-host/src/catalog/bundled.ts

Source file `packages/waypoint-folder-host/src/catalog/bundled.ts` is covered by test imports from `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, and 2 more.

- Tests: `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/tasks/store.test.ts`

### packages/waypoint-folder-host/src/catalog/install.ts

Source file `packages/waypoint-folder-host/src/catalog/install.ts` is covered by test imports from `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, and 2 more.

- Tests: `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/tasks/store.test.ts`

### packages/waypoint-folder-host/src/events/jsonl.ts

Source file `packages/waypoint-folder-host/src/events/jsonl.ts` is covered by test imports from `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, and 2 more.

- Tests: `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`

### packages/waypoint-folder-host/src/tasks/store.ts

Source file `packages/waypoint-folder-host/src/tasks/store.ts` is covered by test imports from `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 2 more.

- Tests: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/routes/state.test.ts`, `packages/waypoint-folder-host/src/tasks/store.test.ts`

### src/index.ts

Source file `src/index.ts` is covered by test imports from `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, and 2 more.

- Tests: `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, `src/wizard/__tests__/shadow-frontmatter.test.ts`, `src/wizard/__tests__/types.test.ts`

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts

Source file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` is covered by bootstrap, document-flow, and document-pr-sync test imports.

- Tests: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`

### packages/waypoint-folder-host/src/firmvault/state.ts

Source file `packages/waypoint-folder-host/src/firmvault/state.ts` is covered by test imports from `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/documents.test.ts`, and 1 more.

- Tests: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/documents.test.ts`, `packages/waypoint-folder-host/src/firmvault/state.test.ts`

### packages/waypoint-folder-host/src/routes/start.ts

Source file `packages/waypoint-folder-host/src/routes/start.ts` is covered by test imports from `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, and 1 more.

- Tests: `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/tasks/store.test.ts`

### packages/waypoint-folder-host/src/firmvault/case-folder.ts

Source file `packages/waypoint-folder-host/src/firmvault/case-folder.ts` is covered by test imports from `packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts`, `packages/waypoint-folder-host/src/firmvault/case-folder.test.ts`.

- Tests: `packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts`, `packages/waypoint-folder-host/src/firmvault/case-folder.test.ts`

### packages/waypoint-folder-host/src/firmvault/facts.ts

Source file `packages/waypoint-folder-host/src/firmvault/facts.ts` is covered by test imports from `packages/waypoint-folder-host/src/firmvault/state.test.ts`, `src/wizard/__tests__/organize.test.ts`.

- Tests: `packages/waypoint-folder-host/src/firmvault/state.test.ts`, `src/wizard/__tests__/organize.test.ts`

### packages/waypoint-folder-host/src/lifecycle/store.ts

Source file `packages/waypoint-folder-host/src/lifecycle/store.ts` is covered by test imports from `packages/waypoint-folder-host/src/lifecycle/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`.

- Tests: `packages/waypoint-folder-host/src/lifecycle/store.test.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`

### src/wizard/firmvault-classifier.ts

Source file `src/wizard/firmvault-classifier.ts` is covered by test imports from `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/organize.test.ts`.

- Tests: `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/organize.test.ts`

### src/wizard/firmvault-review.ts

Source file `src/wizard/firmvault-review.ts` is covered by test imports from `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/questions.test.ts`.

- Tests: `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/questions.test.ts`

### src/wizard/scan.ts

Source file `src/wizard/scan.ts` is covered by test imports from `src/wizard/__tests__/scan.test.ts`, `src/wizard/__tests__/shadows.test.ts`.

- Tests: `src/wizard/__tests__/scan.test.ts`, `src/wizard/__tests__/shadows.test.ts`

### examples/hermes-operator-adapter/src/discussion-loop.ts

Source file `examples/hermes-operator-adapter/src/discussion-loop.ts` is covered by test imports from `examples/hermes-operator-adapter/src/discussion-loop.test.ts`.

- Tests: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`

### examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts

Source file `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts` is covered by test imports from `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`.

- Tests: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`

### examples/hermes-operator-adapter/src/firmvault-document-flow.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-flow.ts` is covered by test imports from `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`.

- Tests: `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`

### examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts` is covered by test imports from `examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts`.

- Tests: `examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts`

### examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts` is covered by test imports from `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`.

- Tests: `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`

## Generated Test Specs

These files preserve existing `@lat` backlinks found in test code.

- No generated test-spec files were discovered.
