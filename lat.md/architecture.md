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

- Code files: 135
- Test files: 109
- Documentation files: 88
- Config files: 4
- Asset files: 0
- Unsupported files: 493

## Structural Graph

Code-KG extracted a deterministic structural graph with 1571 nodes, 2092 edges, 4 communities using the multi-language-directory-fallback analysis path.

## Communities

Directory-based communities provide the first subsystem map until graph clustering is available.

- packages: 100 files, 630 symbols, cohesion 1
- src: 102 files, 501 symbols, cohesion 0.99
- examples: 23 files, 210 symbols, cohesion 1
- root: 1 files, 0 symbols, cohesion 1

## High-Degree Nodes

High-degree nodes may deserve review as important entry points, bridges, or utility hotspots.

- src (module)
- packages (module)
- packages/waypoint-cli/src/bin.ts (file)
- packages/waypoint-folder-host/src/firmvault/state.ts (file)
- examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts (file)
- src/wizard/types.ts (file)
- src/index.ts (file)
- packages/waypoint-cli/src/commands/firmvault.ts (file)
- examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts (file)
- src/wizard/organize.ts (file)

## Dependency Hotspots

Dependency hotspots list source files with incoming local imports so agents can find shared modules and integration points quickly.

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` is imported by local files including `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, and 43 more.

- Imported by: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/catalog.test.ts`, and 39 more

### src/wizard/types.ts

Source file `src/wizard/types.ts` is imported by local files including `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, and 17 more.

- Imported by: `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, and 13 more

### examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts

Source file `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` is imported by local files including `examples/hermes-operator-adapter/src/discussion-loop.test.ts` and 10 more.

- Imported by: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/discussion-loop.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, and 5 more

### packages/waypoint-folder-host/src/project/root.ts

Source file `packages/waypoint-folder-host/src/project/root.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, and 9 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/events/jsonl.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/lifecycle/store.ts`, and 5 more

### packages/waypoint-folder-host/src/project/init.ts

Source file `packages/waypoint-folder-host/src/project/init.ts` is imported by local files including `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, and 8 more.

- Imported by: `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/lifecycle/store.test.ts`, `packages/waypoint-folder-host/src/project/init.test.ts`, and 4 more

### packages/waypoint-folder-host/src/routes/store.ts

Source file `packages/waypoint-folder-host/src/routes/store.ts` is imported by local files including `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 8 more.

- Imported by: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/project/status.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, and 4 more

### examples/hermes-operator-adapter/src/project-registry.ts

Source file `examples/hermes-operator-adapter/src/project-registry.ts` is imported by local files including `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/discussion-loop.ts`, and 7 more.

- Imported by: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/discussion-loop.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`, `examples/hermes-operator-adapter/src/project-registry.test.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`, and 3 more

### packages/waypoint-folder-host/src/catalog/bundled.ts

Source file `packages/waypoint-folder-host/src/catalog/bundled.ts` is imported by local files including `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, and 7 more.

- Imported by: `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/quests/scaffold.ts`, and 3 more

### packages/waypoint-folder-host/src/events/jsonl.ts

Source file `packages/waypoint-folder-host/src/events/jsonl.ts` is imported by local files including `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, and 7 more.

- Imported by: `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/events/event-bus.ts`, `packages/waypoint-folder-host/src/events/jsonl.test.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, and 3 more

### packages/waypoint-folder-host/src/tasks/store.ts

Source file `packages/waypoint-folder-host/src/tasks/store.ts` is imported by local files including `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, and 7 more.

- Imported by: `packages/waypoint-cli/src/commands/resume.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/routes/start.ts`, and 3 more

### packages/waypoint-folder-host/src/firmvault/state.ts

Source file `packages/waypoint-folder-host/src/firmvault/state.ts` is imported by local files including `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/adoption.ts`, and 5 more.

- Imported by: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/adoption.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/firmvault/documents.test.ts`, `packages/waypoint-folder-host/src/firmvault/facts.ts`, `packages/waypoint-folder-host/src/firmvault/state.test.ts`, and 1 more

### packages/waypoint-folder-host/src/catalog/install.ts

Source file `packages/waypoint-folder-host/src/catalog/install.ts` is imported by local files including `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, and 4 more.

- Imported by: `packages/waypoint-folder-host/src/catalog/bundled.test.ts`, `packages/waypoint-folder-host/src/discussion/store.test.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/routes/start.test.ts`, `packages/waypoint-folder-host/src/tasks/store.test.ts`

### packages/waypoint-folder-host/src/routes/types.ts

Source file `packages/waypoint-folder-host/src/routes/types.ts` is imported by local files including `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/project/status.ts`, and 4 more.

- Imported by: `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-folder-host/src/project/status.ts`, `packages/waypoint-folder-host/src/routes/start.ts`, `packages/waypoint-folder-host/src/routes/state.ts`, `packages/waypoint-folder-host/src/routes/store.ts`, `packages/waypoint-folder-host/src/tasks/store.ts`

### src/wizard/paths.ts

Source file `src/wizard/paths.ts` is imported by local files including `src/index.ts`, `src/wizard/organize.ts`, and 4 more.

- Imported by: `src/index.ts`, `src/wizard/organize.ts`, `src/wizard/plan.ts`, `src/wizard/questions.ts`, `src/wizard/scan.ts`, `src/wizard/shadows.ts`

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts

Source file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` is imported by local files including its bootstrap test, document flow test, and 3 more.

- Imported by: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts`

## Source File Highlights

These generated highlights come from deterministic file, symbol, and import extraction so agents can search source-shaped concepts before opening raw files.

### src/index.ts

Source file `src/index.ts` contains source symbols. Key symbols: `WAYPOINT_CORE_PACKAGE`.

- Symbols: `WAYPOINT_CORE_PACKAGE (const)`
- Imports: `src/authoring/design-spec-generator.ts`, `src/authoring/draft.ts`, `src/authoring/handoff-generator.ts`, `src/authoring/quest-generator.ts`, `src/authoring/questionnaires.ts`, `src/authoring/recipe-generator.ts`, and 40 more
- Imported by: `src/__tests__/route.test.ts`, `src/wizard/__tests__/paths.test.ts`, `src/wizard/__tests__/shadow-frontmatter.test.ts`, `src/wizard/__tests__/types.test.ts`

### packages/waypoint-cli/src/bin.ts

Source file `packages/waypoint-cli/src/bin.ts` contains source symbols. Key symbols: `rootPackageVersion`, `WaypointCliIo`, and 3 more.

- Symbols: `rootPackageVersion (const)`, `WaypointCliIo (interface)`, `helpText (const)`, `runWaypointCli (function)`, `defaultIo (function)`
- Imports: `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/discuss.ts`, `packages/waypoint-cli/src/commands/doctor.ts`, `packages/waypoint-cli/src/commands/firmvault.ts`, `packages/waypoint-cli/src/commands/gate.ts`, and 16 more
- Imported by: `packages/waypoint-cli/src/cli.test.ts`, `packages/waypoint-cli/src/commands/author.test.ts`, `packages/waypoint-cli/src/commands/author.ts`, `packages/waypoint-cli/src/commands/auto.test.ts`, `packages/waypoint-cli/src/commands/auto.ts`, `packages/waypoint-cli/src/commands/catalog.test.ts`, and 39 more

### packages/waypoint-folder-host/src/firmvault/state.ts

Source file `packages/waypoint-folder-host/src/firmvault/state.ts` contains source symbols. Key symbols: `FIRMVAULT_LANDMARK_SLUGS`, `FIRMVAULT_CASE_STATE_FILES`, and 60 more.

- Symbols: `FIRMVAULT_LANDMARK_SLUGS (const)`, `FIRMVAULT_CASE_STATE_FILES (const)`, `FirmVaultLandmarkSlug (type)`, `FirmVaultCaseType (type)`, `FirmVaultEvidenceRef (interface)`, `FirmVaultLandmarkState (interface)`, `FirmVaultLandmarkMap (type)`, `FirmVaultLandmarkProjection (interface)`, and 54 more
- Imports: `packages/waypoint-folder-host/src/firmvault/facts.ts`
- Imported by: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`, `packages/waypoint-folder-host/src/firmvault/adoption.ts`, `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`, `packages/waypoint-folder-host/src/firmvault/documents.test.ts`, `packages/waypoint-folder-host/src/firmvault/facts.ts`, `packages/waypoint-folder-host/src/firmvault/state.test.ts`, and 1 more

### examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts

Source file `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` contains source symbols. Key symbols: `FirmVaultCaseType`, `FirmVaultCasesRootRecord`, and 54 more.

- Symbols: `FirmVaultCaseType (type)`, `FirmVaultCasesRootRecord (interface)`, `FirmVaultCasesRegistry (interface)`, `FirmVaultNewCaseRequest (interface)`, `FirmVaultHermesOperatorOptions (interface)`, `FirmVaultHermesBootstrapResult (interface)`, `FirmVaultDocumentKind (type)`, `FirmVaultDocumentHandoffStatus (type)`, and 48 more
- Imports: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`, `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts`

### src/wizard/types.ts

Source file `src/wizard/types.ts` contains source symbols. Key symbols: `WIZARD_DOMAINS`, `WizardDomain`, and 29 more.

- Symbols: `WIZARD_DOMAINS (const)`, `WizardDomain (type)`, `WizardConfidence (type)`, `WizardReviewStatus (type)`, `WizardQuestionStatus (type)`, `WizardSourcePointer (interface)`, `WizardSourceFile (interface)`, `WizardClassification (interface)`, and 23 more
- Imports: none detected
- Imported by: `src/index.ts`, `src/wizard/__tests__/firmvault-apply.test.ts`, `src/wizard/__tests__/firmvault-classifier.test.ts`, `src/wizard/__tests__/firmvault-facts.test.ts`, `src/wizard/__tests__/firmvault-review.test.ts`, `src/wizard/__tests__/organize.test.ts`, and 13 more

### packages/waypoint-cli/src/commands/firmvault.ts

Source file `packages/waypoint-cli/src/commands/firmvault.ts` contains source symbols. Key symbols: `InitFirmVaultCaseStateResult`, `BootstrapFirmVaultCaseResult`, and 40 more.

- Symbols: `InitFirmVaultCaseStateResult (interface)`, `BootstrapFirmVaultCaseResult (interface)`, `FirmVaultLandmarkProjection (interface)`, `FirmVaultEvidencePathCheck (interface)`, `SetFirmVaultCaseFactResult (interface)`, `ReadFirmVaultCaseStateResult (interface)`, `FirmVaultCaseGuidanceAction (interface)`, `FirmVaultCaseGuidanceResult (interface)`, and 34 more
- Imports: `packages/waypoint-cli/src/bin.ts`
- Imported by: `packages/waypoint-cli/src/bin.ts`

### examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts

Source file `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` contains source symbols. Key symbols: `SafeWaypointCommandSpec`, `WaypointCommandResult`, and 23 more.

- Symbols: `SafeWaypointCommandSpec (interface)`, `WaypointCommandResult (interface)`, `WaypointCommandExecutor (type)`, `RunSafeWaypointCommandOptions (interface)`, `CommandRule (type)`, `FIRMVAULT_DOCUMENT_KINDS (const)`, `FIRMVAULT_HANDOFF_STATUSES (const)`, `FIRMVAULT_STATE_SECTIONS (const)`, and 17 more
- Imports: `examples/hermes-operator-adapter/src/project-registry.ts`
- Imported by: `examples/hermes-operator-adapter/src/discussion-loop.test.ts`, `examples/hermes-operator-adapter/src/discussion-loop.ts`, `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`, `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts`, and 5 more

### src/wizard/organize.ts

Source file `src/wizard/organize.ts` contains source symbols. Key symbols: `CreateWizardOrganizedDocumentEntryInput`, `BuildWizardOrganizationPlanInput`, and 35 more.

- Symbols: `CreateWizardOrganizedDocumentEntryInput (type)`, `BuildWizardOrganizationPlanInput (interface)`, `WriteWizardOrganizationPlanInput (interface)`, `WriteWizardOrganizationPlanResult (interface)`, `WriteWizardOrganizedCasePackageInput (interface)`, `WriteWizardOrganizedCasePackageResult (interface)`, `ORGANIZATION_PLAN_RELATIVE_PATH (const)`, `SOURCE_MANIFEST_RELATIVE_PATH (const)`, and 29 more
- Imports: `src/wizard/paths.ts`, `src/wizard/types.ts`
- Imported by: `src/index.ts`, `src/wizard/__tests__/organize.test.ts`

### packages/waypoint-folder-host/src/autopilot/run.ts

Source file `packages/waypoint-folder-host/src/autopilot/run.ts` contains source symbols. Key symbols: `DEFAULT_MAX_ITERATIONS`, `runWaypointAutopilot`, and 23 more.

- Symbols: `DEFAULT_MAX_ITERATIONS (const)`, `runWaypointAutopilot (function)`, `listWaypointAutopilotRuns (function)`, `createRecipeRuntime (function)`, `loadRecipeManifest (function)`, `walkYamlFiles (function)`, `blockTaskForMissingArtifacts (function)`, `missingOutputArtifacts (function)`, and 17 more
- Imports: `packages/waypoint-folder-host/src/autopilot/types.ts`, `packages/waypoint-folder-host/src/events/jsonl.ts`, `packages/waypoint-folder-host/src/project/config.ts`, `packages/waypoint-folder-host/src/project/root.ts`, `packages/waypoint-folder-host/src/routes/store.ts`, `packages/waypoint-folder-host/src/runtime/local-runtime.ts`, and 3 more
- Imported by: `packages/waypoint-folder-host/src/autopilot/run.test.ts`, `packages/waypoint-folder-host/src/index.ts`

### packages/waypoint-folder-host/src/index.ts

Source file `packages/waypoint-folder-host/src/index.ts` contains source symbols. Key symbols: `WAYPOINT_CORE_PACKAGE`, `WAYPOINT_FOLDER_HOST_PACKAGE`, and 2 more.

- Symbols: `WAYPOINT_CORE_PACKAGE (const)`, `WAYPOINT_FOLDER_HOST_PACKAGE (const)`, `WaypointFolderHostInfo (interface)`, `getWaypointFolderHostInfo (function)`
- Imports: `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/autopilot/types.ts`, `packages/waypoint-folder-host/src/catalog/bundled.ts`, `packages/waypoint-folder-host/src/catalog/install.ts`, `packages/waypoint-folder-host/src/discussion/store.ts`, `packages/waypoint-folder-host/src/discussion/types.ts`, and 27 more
- Imported by: none detected

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

### examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts

Source file `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.ts` contains source symbols. Key symbols: `FirmVaultDocumentPrState`, `FirmVaultDocumentPrLookup`, and 10 more.

- Symbols: `FirmVaultDocumentPrState (type)`, `FirmVaultDocumentPrLookup (interface)`, `FirmVaultDocumentPrStatus (interface)`, `FirmVaultDocumentPrStatusClient (type)`, `FirmVaultDocumentPrSyncRequest (interface)`, `FirmVaultDocumentPrSyncOptions (interface)`, `FirmVaultDocumentPrSyncResult (interface)`, `syncFirmVaultDocumentPrStatusWithHermesOperator (function)`, and 4 more
- Imports: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`, `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Imported by: `examples/hermes-operator-adapter/src/firmvault-document-pr-sync.test.ts`
