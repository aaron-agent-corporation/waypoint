# Architecture
<!-- code-kg:id architecture.overview -->

This section summarizes the repository shape discovered during the first Code-KG bootstrap.

## Project Signals

Detected project signals help orient agents before broad source reads.

- @waypoint/core (Node/TypeScript)

## Entry Points

Entry points are candidate files to inspect first when source verification is needed.

- ./dist/src/index.js
- src/index.ts

## Entry Point Flow

Entry point flow lists first-hop local imports from discovered startup files so agents can follow runtime paths before opening source.

### src/index.ts

Entry point `src/index.ts` imports first-hop local files including `src/authoring/design-spec-generator.ts`, `src/authoring/draft.ts`, and 44 more.

- Imports: `src/authoring/design-spec-generator.ts`, `src/authoring/draft.ts`, `src/authoring/handoff-generator.ts`, `src/authoring/quest-generator.ts`, `src/authoring/questionnaires.ts`, `src/authoring/recipe-generator.ts`, and 40 more

## File Inventory

The initial inventory groups files by broad category so later extraction can focus on high-value paths.

- Code files: 209
- Test files: 182
- Documentation files: 105
- Config files: 8
- Asset files: 0
- Unsupported files: 191

## Structural Graph

Code-KG extracted a deterministic structural graph with 2608 nodes, 3895 edges, 4 communities using the multi-language-directory-fallback analysis path.

## Communities

Directory-based communities provide the first subsystem map until graph clustering is available.

- packages: 243 files, 1514 symbols, cohesion 1
- src: 102 files, 501 symbols, cohesion 0.99
- examples: 23 files, 220 symbols, cohesion 1
- root: 1 files, 0 symbols, cohesion 1

## High-Degree Nodes

High-degree nodes may deserve review as important entry points, bridges, or utility hotspots.

- packages (module)
- src (module)
- packages/waypoint-folder-host/src/gascity/cli-adapter.ts (file)
- packages/waypoint-cli/src/bin.ts (file)
- packages/waypoint-folder-host/src/beads/cli-client.ts (file)
- packages/waypoint-folder-host/src/firmvault/state.ts (file)
- examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts (file)
- packages/waypoint-folder-host/src/catalog/bundled.ts (file)
- packages/waypoint-engine-host/src/core/engine-host.ts (file)
- packages/waypoint-folder-host/src/beads/reconstruct.ts (file)

## Dependency Hotspots

Dependency hotspots list source files with incoming local imports so agents can find shared modules and integration points quickly.

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` is imported by local files including `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, and 45 more.

- Imported by: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts`, and 41 more

### packages/waypoint-folder-host/src/catalog/bundled.ts

Source file `packages/waypoint-folder-host/src/catalog/bundled.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, and 27 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/formula.test.ts`, and 23 more

### packages/waypoint-engine-host/src/core/engine-host.ts

Source file `packages/waypoint-engine-host/src/core/engine-host.ts` is imported by local files including `packages/waypoint-engine-host/src/__tests__/author.test.ts`, `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`, and 24 more.

- Imported by: `packages/waypoint-engine-host/src/__tests__/author.test.ts`, `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/gate.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/http-ws.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.beads.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.lifecycle.test.ts`, and 20 more

### packages/waypoint-folder-host/src/beads/cli-client.ts

Source file `packages/waypoint-folder-host/src/beads/cli-client.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, and 23 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/autopilot/types.ts`, `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.ts`, and 19 more

### packages/waypoint-folder-host/src/beads/reconstruct.ts

Source file `packages/waypoint-folder-host/src/beads/reconstruct.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, and 18 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/beads/cli-client.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/execution.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, and 14 more

### src/wizard/types.ts

Source file `src/wizard/types.ts` is imported by local files including `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, and 17 more.

- Imported by: `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, and 13 more

### packages/waypoint-folder-host/src/project/init.ts

Source file `packages/waypoint-folder-host/src/project/init.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, and 16 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/events/read-model.test.ts`, and 12 more

### packages/waypoint-folder-host/src/project/root.ts

Source file `packages/waypoint-folder-host/src/project/root.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, and 16 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, `packages/waypoint-folder-host/src/catalog/workspace.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/events/jsonl.ts`, `packages/waypoint-folder-host/src/events/read-model.ts`, and 12 more

### packages/waypoint-engine-host/src/types.ts

Source file `packages/waypoint-engine-host/src/types.ts` is imported by local files including `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, and 14 more.

- Imported by: `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`, `packages/waypoint-engine-host/src/__tests__/run.folder.test.ts`, `packages/waypoint-engine-host/src/bin.ts`, `packages/waypoint-engine-host/src/brain/agent-session.test.ts`, `packages/waypoint-engine-host/src/brain/agent-session.ts`, and 10 more

### packages/waypoint-folder-host/src/beads/instantiate.ts

Source file `packages/waypoint-folder-host/src/beads/instantiate.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/cli-client.ts`, and 14 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/beads/cli-client.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/instantiate.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/beads/reconstruct.test.ts`, and 10 more

### packages/waypoint-folder-host/src/events/jsonl.ts

Source file `packages/waypoint-folder-host/src/events/jsonl.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, and 13 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/events/event-bus.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/events/read-model.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`, and 9 more

### packages/waypoint-engine-host/src/envelope.ts

Source file `packages/waypoint-engine-host/src/envelope.ts` is imported by local files including `packages/waypoint-engine-host/src/__tests__/command-bus.test.ts`, `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, and 12 more.

- Imported by: `packages/waypoint-engine-host/src/__tests__/command-bus.test.ts`, `packages/waypoint-engine-host/src/__tests__/envelope.shape.test.ts`, `packages/waypoint-engine-host/src/__tests__/envelope.test.ts`, `packages/waypoint-engine-host/src/core/command-bus.ts`, `packages/waypoint-engine-host/src/core/commands/agent.ts`, `packages/waypoint-engine-host/src/core/commands/author.ts`, and 8 more

### packages/waypoint-folder-host/src/routes/store.ts

Source file `packages/waypoint-folder-host/src/routes/store.ts` is imported by local files including `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 12 more.

- Imported by: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/gascity/diagnostics.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/routes/read-model.test.ts`, and 8 more

### packages/waypoint-folder-host/src/tasks/store.ts

Source file `packages/waypoint-folder-host/src/tasks/store.ts` is imported by local files including `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 12 more.

- Imported by: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/index.ts`, and 8 more

### packages/waypoint-folder-host/src/project/config.ts

Source file `packages/waypoint-folder-host/src/project/config.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, and 11 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/events/read-model.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/gascity/delegate.ts`, `packages/waypoint-folder-host/src/index.ts`, and 7 more

## Source File Highlights

These generated highlights come from deterministic file, symbol, and import extraction so agents can search source-shaped concepts before opening raw files.

### src/index.ts

Source file `src/index.ts` contains source symbols. Key symbols: `WAYPOINT_CORE_PACKAGE`.

- Symbols: `WAYPOINT_CORE_PACKAGE (const)`
- Imports: `src/authoring/design-spec-generator.ts`, `src/authoring/draft.ts`, `src/authoring/handoff-generator.ts`, `src/authoring/quest-generator.ts`, `src/authoring/questionnaires.ts`, `src/authoring/recipe-generator.ts`, and 40 more
- Imported by: `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, `src/wizard/__tests__/shadow-frontmatter.test.ts`, `src/wizard/__tests__/types.test.ts`

### packages/waypoint-folder-host/src/gascity/cli-adapter.ts

Source file `packages/waypoint-folder-host/src/gascity/cli-adapter.ts` contains source symbols. Key symbols: `WaypointGasCityCliAdapterConfig`, `WaypointGasCityCommandInput`, and 89 more.

- Symbols: `WaypointGasCityCliAdapterConfig (interface)`, `WaypointGasCityCommandInput (interface)`, `WaypointGasCityCommandOutput (interface)`, `WaypointGasCityCommandRunner (interface)`, `WaypointGasCityCommandResult (interface)`, `WaypointGasCityVersion (interface)`, `WaypointGasCityPreflightTool (type)`, `WaypointGasCityPreflightInput (interface)`, and 83 more
- Imports: none detected
- Imported by: `packages/waypoint-folder-host/src/gascity/cli-adapter.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.test.ts`, `packages/waypoint-folder-host/src/gascity/delegate.ts`, `packages/waypoint-folder-host/src/gascity/diagnostics.ts`, `packages/waypoint-folder-host/src/gascity/metadata.ts`, `packages/waypoint-folder-host/src/index.ts`

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` contains source symbols. Key symbols: `rootPackageVersion`, `WaypointCliIo`, and 3 more.

- Symbols: `rootPackageVersion (const)`, `WaypointCliIo (interface)`, `helpText (const)`, `runWaypointCli (function)`, `defaultIo (function)`
- Imports: `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/discuss.ts`, `packages/waypoint-cli/src/commands/doctor.ts`, `packages/waypoint-cli/src/commands/firmvault.ts`, `packages/waypoint-cli/src/commands/gascity.ts`, and 17 more
- Imported by: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts`, and 41 more

### packages/waypoint-folder-host/src/beads/cli-client.ts

Source file `packages/waypoint-folder-host/src/beads/cli-client.ts` contains source symbols. Key symbols: `WaypointBeadsCliIssueClientConfig`, `WaypointBeadsCliCommandInput`, and 49 more.

- Symbols: `WaypointBeadsCliIssueClientConfig (interface)`, `WaypointBeadsCliCommandInput (interface)`, `WaypointBeadsCliCommandOutput (interface)`, `WaypointBeadsCliCommandRunner (interface)`, `WaypointBeadsIssueSnapshotListResult (interface)`, `WaypointBeadsIssueSnapshotReader (interface)`, `WaypointBeadsIssueCommentSnapshot (interface)`, `WaypointBeadsIssueCommentReader (interface)`, and 43 more
- Imports: `packages/waypoint-folder-host/src/beads/instantiate.ts`, `packages/waypoint-folder-host/src/beads/reconstruct.ts`
- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/autopilot/types.ts`, `packages/waypoint-folder-host/src/beads/cli-client.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.test.ts`, `packages/waypoint-folder-host/src/beads/transitions.ts`, and 19 more

### packages/waypoint-folder-host/src/firmvault/state.ts

Source file `packages/waypoint-folder-host/src/firmvault/state.ts` contains source symbols. Key symbols: `FIRMVAULT_LANDMARK_SLUGS`, `FIRMVAULT_CASE_STATE_FILES`, and 60 more.

- Symbols: `FIRMVAULT_LANDMARK_SLUGS (const)`, `FIRMVAULT_CASE_STATE_FILES (const)`, `FirmVaultLandmarkSlug (type)`, `FirmVaultCaseType (type)`, `FirmVaultEvidenceRef (interface)`, `FirmVaultLandmarkState (interface)`, `FirmVaultLandmarkMap (type)`, `FirmVaultLandmarkProjection (interface)`, and 54 more
- Imports: `packages/waypoint-folder-host/src/firmvault/facts.ts`
- Imported by: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/adoption.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/firmvault/documents.test.ts`, `packages/waypoint-folder-host/src/firmvault/facts.ts`, `packages/waypoint-folder-host/src/firmvault/state.test.ts`, and 1 more

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts

Source file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` contains source symbols. Key symbols: `FirmVaultCaseType`, `WaypointRouteBackendMode`, and 58 more.

- Symbols: `FirmVaultCaseType (type)`, `WaypointRouteBackendMode (type)`, `FirmVaultCasesRootRecord (interface)`, `FirmVaultCasesRegistry (interface)`, `FirmVaultNewCaseRequest (interface)`, `FirmVaultHermesOperatorOptions (interface)`, `FirmVaultHermesBootstrapResult (interface)`, `FirmVaultHermesBeadsRouteSummary (interface)`, and 52 more
- Imports: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts`

### packages/waypoint-folder-host/src/catalog/bundled.ts

Source file `packages/waypoint-folder-host/src/catalog/bundled.ts` contains source symbols. Key symbols: `CatalogQuestManifest`, `CatalogRecipeManifest`, and 17 more.

- Symbols: `CatalogQuestManifest (interface)`, `CatalogRecipeManifest (interface)`, `CatalogRegistry (interface)`, `WaypointCatalogEntry (interface)`, `BundledWaypointCatalog (interface)`, `ResolveCatalogQuestRecipesResult (type)`, `LoadBundledWaypointCatalogOptions (interface)`, `loadBundledWaypointCatalog (function)`, and 11 more
- Imports: none detected
- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.test.ts`, `packages/waypoint-folder-host/src/beads/compiler.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/formula.test.ts`, and 23 more

### packages/waypoint-engine-host/src/core/engine-host.ts

Source file `packages/waypoint-engine-host/src/core/engine-host.ts` contains source symbols. Key symbols: `EngineContext`, `resolveBrainFactory`, and 3 more.

- Symbols: `EngineContext (interface)`, `resolveBrainFactory (function)`, `EngineHost (interface)`, `EngineHostConfig (interface)`, `createEngineHost (function)`
- Imports: `packages/waypoint-engine-host/src/brain/agent-registry.ts`, `packages/waypoint-engine-host/src/brain/brain-adapter.ts`, `packages/waypoint-engine-host/src/brain/fake-adapter.ts`, `packages/waypoint-engine-host/src/core/command-bus.ts`, `packages/waypoint-engine-host/src/core/commands/agent.ts`, `packages/waypoint-engine-host/src/core/commands/author.ts`, and 12 more
- Imported by: `packages/waypoint-engine-host/src/__tests__/author.test.ts`, `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/gate.folder.test.ts`, `packages/waypoint-engine-host/src/__tests__/http-ws.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.beads.test.ts`, `packages/waypoint-engine-host/src/__tests__/integration.lifecycle.test.ts`, and 20 more

### packages/waypoint-folder-host/src/beads/reconstruct.ts

Source file `packages/waypoint-folder-host/src/beads/reconstruct.ts` contains source symbols. Key symbols: `WaypointBeadsSnapshotStatus`, `WaypointBeadsRunStatus`, and 25 more.

- Symbols: `WaypointBeadsSnapshotStatus (type)`, `WaypointBeadsRunStatus (type)`, `WaypointBeadsRunTaskStatus (type)`, `WaypointBeadsIssueDependencySnapshot (interface)`, `WaypointBeadsIssueSnapshot (interface)`, `WaypointBeadsDependencySnapshot (interface)`, `ReconstructWaypointRunFromBeadsInput (interface)`, `WaypointBeadsRunTask (interface)`, and 19 more
- Imports: `packages/waypoint-folder-host/src/beads/compiler.ts`
- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/beads/cli-client.ts`, `packages/waypoint-folder-host/src/beads/execution.test.ts`, `packages/waypoint-folder-host/src/beads/execution.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, and 14 more

### packages/waypoint-folder-host/src/autopilot/run.ts

Source file `packages/waypoint-folder-host/src/autopilot/run.ts` contains source symbols. Key symbols: `DEFAULT_MAX_ITERATIONS`, `runWaypointAutopilot`, and 30 more.

- Symbols: `DEFAULT_MAX_ITERATIONS (const)`, `runWaypointAutopilot (function)`, `runWaypointBeadsAutopilot (function)`, `listWaypointAutopilotRuns (function)`, `defaultBeadsRouteId (function)`, `loadBeadsRun (function)`, `beadsMutationClient (function)`, `beadsRuntimePolicyFor (function)`, and 24 more
- Imports: `packages/waypoint-folder-host/src/autopilot/types.ts`, `packages/waypoint-folder-host/src/beads/cli-client.ts`, `packages/waypoint-folder-host/src/beads/execution.ts`, `packages/waypoint-folder-host/src/beads/reconstruct.ts`, `packages/waypoint-folder-host/src/beads/verification.ts`, `packages/waypoint-folder-host/src/catalog/workspace.ts`, and 9 more
- Imported by: `packages/waypoint-folder-host/src/autopilot/beads-run.test.ts`, `packages/waypoint-folder-host/src/autopilot/load-recipe-manifest.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/beads/parity.test.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/routes/start-adhoc.ts`

### src/wizard/types.ts

Source file `src/wizard/types.ts` contains source symbols. Key symbols: `WIZARD_DOMAINS`, `WizardDomain`, and 29 more.

- Symbols: `WIZARD_DOMAINS (const)`, `WizardDomain (type)`, `WizardConfidence (type)`, `WizardReviewStatus (type)`, `WizardQuestionStatus (type)`, `WizardSourcePointer (interface)`, `WizardSourceFile (interface)`, `WizardClassification (interface)`, and 23 more
- Imports: none detected
- Imported by: `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, and 13 more

### examples/hermes-operator-adapter/src/discussion-loop.ts

Source file `examples/hermes-operator-adapter/src/discussion-loop.ts` contains source symbols. Key symbols: `HermesDiscussionAgentInput`, `HermesDiscussionAgentReply`, and 9 more.

- Symbols: `HermesDiscussionAgentInput (interface)`, `HermesDiscussionAgentReply (interface)`, `HermesDiscussionAgentRuntime (interface)`, `RunHermesDiscussionLoopInput (interface)`, `HermesDiscussionLoopResult (interface)`, `defaultRuntime (const)`, `runHermesDiscussionLoop (function)`, `DiscussionOutputSnapshot (interface)`, and 3 more
- Imports: `examples/hermes-operator-adapter/src/project-registry.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`

### examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts

Source file `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts` contains source symbols. Key symbols: `RunEndToEndHermesSmokeInput`, `EndToEndHermesSmokeResult`, and 7 more.

- Symbols: `RunEndToEndHermesSmokeInput (interface)`, `EndToEndHermesSmokeResult (interface)`, `runEndToEndHermesSmoke (function)`, `configureLocalHermesRecipeRuntime (function)`, `configureNullRecipeRuntime (function)`, `runSetupWaypointCommand (function)`, `spawnCommand (function)`, `parseAutopilotStatus (function)`, and 1 more
- Imports: `examples/hermes-operator-adapter/src/discussion-loop.ts`, `examples/hermes-operator-adapter/src/project-registry.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`, `examples/hermes-operator-adapter/src/telegram-gate-loop.ts`
- Imported by: `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`

### examples/hermes-operator-adapter/src/firmvault-document-flow.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-flow.ts` contains source symbols. Key symbols: `FirmVaultDocumentFlowPipelineRunner`, `FirmVaultScannedDocumentFlowRequest`, and 5 more.

- Symbols: `FirmVaultDocumentFlowPipelineRunner (type)`, `FirmVaultScannedDocumentFlowRequest (interface)`, `FirmVaultScannedDocumentFlowOptions (interface)`, `FirmVaultScannedDocumentFlowResult (interface)`, `processFirmVaultScannedDocumentWithHermesOperator (function)`, `validateFlowRequest (function)`, `assertSafeCaseSlug (function)`
- Imports: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`

### examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts` contains source symbols. Key symbols: `FirmVaultDocumentPipelineStatus`, `FirmVaultDocumentPipelineWorkflow`, and 16 more.

- Symbols: `FirmVaultDocumentPipelineStatus (type)`, `FirmVaultDocumentPipelineWorkflow (type)`, `FirmVaultDocumentPipelineRequest (interface)`, `FirmVaultDocumentPipelineSpec (interface)`, `FirmVaultDocumentPipelineRawResult (interface)`, `FirmVaultDocumentPipelineExecutor (type)`, `FirmVaultDocumentPipelineOptions (interface)`, `FirmVaultDocumentPipelineResult (interface)`, and 10 more
- Imports: none detected
- Imported by: `examples/hermes-operator-adapter/src/firmvault-document-flow.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts`
