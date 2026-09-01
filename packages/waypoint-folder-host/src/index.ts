export { initWaypointProject } from './project/init.ts'
export type { InitWaypointProjectOptions, InitWaypointProjectResult } from './project/init.ts'
export { readWaypointStatus } from './project/status.ts'
export type { WaypointProjectStatus } from './project/status.ts'
export { findWaypointProjectRoot, getWaypointProjectPaths, runnerConfigExists, WAYPOINT_DIR_NAME } from './project/root.ts'
export type { WaypointProjectPaths } from './project/root.ts'
export {
  createWaypointProjectConfig,
  extractQuestRoots,
  parseWaypointProjectConfig,
  readWaypointProjectConfig,
  recipeRuntimeProblem,
  serializeWaypointProjectConfig,
} from './project/config.ts'
export type {
  WaypointPostgresBackendConfig,
  WaypointProjectBackendConfig,
  WaypointProjectConfig,
  WaypointProjectRootConfig,
  WaypointProjectRuntimeConfig,
  WaypointProjectSandboxConfig,
  WaypointProjectSandboxBrokerConfig,
  WaypointProjectSandboxCredentialConfig,
  WaypointProjectSandboxEgressConfig,
  WaypointProjectWorkerLaneConfig,
  WaypointProjectWorkerRuntimeConfig,
  WaypointRecipeRuntimeMode,
  WaypointRootAccess,
  WaypointRouteBackendMode,
  WaypointSandboxBackend,
} from './project/config.ts'
export { SANDBOX_ENV, sandboxConfigProblem, sandboxDisabledByEnv, sandboxEnabledForProject } from './sandbox/gate.ts'
export { assembleSandboxMounts, toMountArgs } from './sandbox/mounts.ts'
export type { SandboxMount, SandboxMountInput } from './sandbox/mounts.ts'
export { claimHostPath, claimRelPath, claimSandboxPath, fileClaimReportContract, readSandboxClaim, toSandboxPath } from './sandbox/claim.ts'
export { buildSandboxArgv, DEFAULT_MOUNT_PATH, orderHostPath, prepareSandboxedRun, resolveCredentialFiles, SANDBOX_COMMAND_ENV } from './sandbox/runtime.ts'
export type { ResolvedCredentialFile, SandboxArgvInput, SandboxPreparation, SandboxPrepareInput } from './sandbox/runtime.ts'
export { loadBundledWaypointCatalog, formatCatalogEntryWarning, CatalogLoadError } from './catalog/bundled.ts'
export { auditCatalogRecipes, findingsOfCode } from './catalog/audit.ts'
export type { CatalogFinding, CatalogFindingCode } from './catalog/audit.ts'
export { loadWorkspaceWaypointCatalog } from './catalog/workspace.ts'
export type {
  BundledWaypointCatalog,
  CatalogEntryError,
  CatalogRecipeManifest,
  LoadEntriesOptions,
  ResolveCatalogQuestRecipesResult,
  WaypointCatalogEntry,
} from './catalog/bundled.ts'
export { installQuestCatalog } from './catalog/install.ts'
export type { InstallQuestCatalogOptions, InstallQuestCatalogResult } from './catalog/install.ts'
export {
  addLifecycleMilestone,
  addLifecyclePhase,
  addLifecyclePlan,
  addLifecycleWorkstream,
  listLifecycleState,
} from './lifecycle/store.ts'
export type {
  AddLifecycleMilestoneInput,
  AddLifecyclePhaseInput,
  AddLifecyclePlanInput,
  AddLifecycleWorkstreamInput,
  LifecycleMilestone,
  LifecyclePhase,
  LifecyclePlan,
  LifecycleState,
  LifecycleWorkstream,
} from './lifecycle/types.ts'
export { createWaypointRoute, getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from './routes/store.ts'
export { approveRouteGate, cancelWaypointRoute, pauseWaypointRoute, presentGateChangeset, rejectRouteGate, resolveWaypointRouteBlocker, resumeWaypointRoute } from './routes/state.ts'
export { CHANGESET_ALGORITHM, computeChangesetDigest, gateApprovesChangeset, gatedArtifactPaths } from './routes/changeset.ts'
export type { ChangesetDigest, ChangesetManifestEntry } from './routes/changeset.ts'
export type { GateChangesetPresentation, RouteGateDecisionInput } from './routes/state.ts'
export { startQuestRoute } from './routes/start.ts'
export type { StartQuestRouteOptions, StartedQuestRoute } from './routes/start.ts'
export {
  bridgeRegistryDir,
  bridgeRegistryRecordPath,
  readBridgeRegistryRecord,
  registerBridgeProject,
} from './pgdurable/bridge-registry.ts'
export type { BridgeRegistryRecord } from './pgdurable/bridge-registry.ts'
export { startAdhocRoute, AdhocManifestError, buildAdhocRecipeQuestYaml } from './routes/start-adhoc.ts'
export type { StartAdhocRouteOptions, StartedAdhocRoute, AdhocRecipeQuestOptions } from './routes/start-adhoc.ts'
export { getWaypointRuntimeRoute, getWaypointRuntimeTask, listWaypointRuntimeOpenDispatches, listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from './routes/read-model.ts'
export type { ListWaypointRuntimeTasksOptions, WaypointOpenDispatch } from './routes/read-model.ts'
export { findAbandonedRoutes, reapAbandonedRoutes } from './routes/reap.ts'
export type { FindAbandonedRoutesOptions, ReapResult, RouteReapCandidate } from './routes/reap.ts'
export { applyQuestScaffold } from './quests/scaffold.ts'
export type { AppliedQuestScaffoldSummary, ApplyQuestScaffoldOptions } from './quests/scaffold.ts'
export type {
  CreateWaypointRouteInput,
  WaypointFolderRoute,
  WaypointFolderRouteStatus,
  WaypointFolderRouteSubject,
} from './routes/types.ts'
export { appendRouteEvent, readRouteEvents } from './events/jsonl.ts'
export { readWaypointRuntimeRouteEvents } from './events/read-model.ts'
export type { WaypointRuntimeRouteEventOptions } from './events/read-model.ts'
export { createRouteEventBus } from './events/event-bus.ts'
export { extractScaffoldPlans, getWaypointTask, listWaypointTasks, materializeQuestTasks, taskKindFor, updateWaypointTask } from './tasks/store.ts'
export type { WaypointFolderTask, WaypointFolderTaskKind, WaypointFolderTaskState, WaypointFolderTaskStatus } from './tasks/types.ts'
export { listWaypointAutopilotRuns, runWaypointAutopilot } from './autopilot/run.ts'
export { NullRecipeRuntime, UnconfiguredRecipeRuntime } from './runtime/null-runtime.ts'
export type {
  RunWaypointAutopilotOptions,
  RunWaypointAutopilotResult,
  WaypointAutopilotRunPage,
  WaypointAutopilotRunRecord,
  WaypointAutopilotRunStatus,
} from './autopilot/types.ts'
export { appendTaskDiscussionMessage, readTaskDiscussionMessages } from './discussion/store.ts'
export { LocalRecipeRuntime } from './runtime/local-runtime.ts'
export { mootRouteGate } from './routes/state.ts'
export type { LocalRecipePayload, LocalRecipePayloadInput } from './runtime/payload.ts'
export { buildLocalRecipePayload } from './runtime/payload.ts'
export type {
  AppendTaskDiscussionMessageInput,
  TaskDiscussionMessagePage,
  WaypointDiscussionAuthor,
  WaypointTaskDiscussionMessage,
} from './discussion/types.ts'
export type {
  AppendRouteEventInput,
  ReadRouteEventsOptions,
  RouteEventPage,
  WaypointFolderRouteEvent,
} from './events/types.ts'
export { DEFAULT_POSTGRES_URL, deriveProjectSchemaName, isDurablePostgresRouteBackend } from './project/backend.ts'
export {
  cancelSchemaDurableInstances,
  dispatchChannelName,
  dropProjectSchemas,
  getWaypointPostgres,
  quoteIdent,
} from './postgres/client.ts'
export { migrateFolderProjectToPostgres } from './postgres/migrate.ts'
export type { MigrateFolderProjectResult } from './postgres/migrate.ts'
export {
  latestDurableTaskAttempt,
  reportDurableTaskAttempt,
  retryDurableWaypointTask,
  runWaypointBridge,
} from './pgdurable/bridge.ts'
export { compileQuestToDurableGraph } from './pgdurable/compiler.ts'
export type {
  DurableTaskAttemptReport,
  DurableTaskAttemptRow,
  ReportDurableTaskAttemptResult,
  RetryDurableTaskResult,
  RunWaypointBridgeOptions,
  RunWaypointBridgeResult,
  WaypointBridgeProcessed,
  WaypointBridgeRecipeRuntime,
  WaypointBridgeRecipeRuntimeInput,
} from './pgdurable/bridge.ts'

// Seatbelt write jail (P3/W2): fail-closed profile compiler +
// sandbox-exec wrapping for the worker spawn path (golden-filed).
export type { SeatbeltAccess, SeatbeltRoot } from './seatbelt/profile.ts'
export { compileSeatbeltProfile } from './seatbelt/profile.ts'
export { seatbeltAvailable, seatbeltCommand, seatbeltWrapArgv, writeSeatbeltProfile } from './seatbelt/wrap.ts'
export type { PreparedSeatbeltJail, SeatbeltJailInput } from './seatbelt/jail.ts'
export {
  assembleSeatbeltJailRoots,
  prepareSeatbeltJail,
  SEATBELT_ENV,
  seatbeltEnabledForProject,
  seatbeltJailEnabled,
} from './seatbelt/jail.ts'

// Worker runtime (P3/W3): the host spawns agent subprocesses directly —
// work order on stdin, Seatbelt-wrapped argv, outcome = process exit x the
// W1 report row.
export type {
  WorkerRecipeRuntimeConfig,
  WorkerRecipeRuntimeInput,
  WorkerRecipeRuntimeOutput,
  WorkerRecipeRuntimeUsage,
} from './runtime/worker-runtime.ts'
export { WorkerRecipeRuntime } from './runtime/worker-runtime.ts'
export { ensurePythonVenv } from './runtime/python-venv.ts'
export type { EnsurePythonVenvOptions } from './runtime/python-venv.ts'
export { PiRecipeRuntime } from './runtime/pi-runtime.ts'
export type {
  PiModelResolver,
  PiRecipeRuntimeConfig,
  PiRecipeRuntimeInput,
  PiRecipeRuntimeOutput,
  PiRecipeRuntimeStatus,
  PiToolRegistry,
} from './runtime/pi-runtime.ts'
export { piRecipeRuntimeFor } from './runtime/pi-runtime-for.ts'
export {
  loadProviderRegistry,
  parseModelTargets,
  parseProviderRegistry,
  resolveModelTarget,
} from './runtime/model-routing.ts'
export type {
  ModelTarget,
  ModelTargets,
  ProviderAuthKind,
  ProviderRegistry,
  ProviderRegistryEntry,
  ResolveModelTargetResult,
} from './runtime/model-routing.ts'
export type {
  RecipeModelClass,
  RecipeRuntimeApply,
  RecipeRuntimeOutputStatus,
  RecipeRuntimePriorAttempt,
  WorkOrderInput,
  WorkOrderOptions,
} from './runtime/work-order.ts'
export { applyScratchArtifacts, buildWorkOrder, verifyScratchArtifacts } from './runtime/work-order.ts'

// Tier-tuning scorecard (rsc-b5b): per-recipe dispatch outcomes from the
// durable store — the dispatch-row readout that replaced the city-based
// tier-report tool (docs/MODEL-ROUTING.md).
export type { WaypointTierReportRow } from './reports/tier-report.ts'
export { spineTierReport } from './reports/tier-report.ts'
// run dossier (rsc-9y6, docs/designs/run-dossier.md).
export type { WaypointRunDossierOptions, WaypointRunDossierResult } from './reports/run-dossier.ts'
export { defaultConsoleUrl, writeWaypointRunDossier } from './reports/run-dossier.ts'
// The case pulse — the ONE status surface (the sweep writes it; the Case
// Pulse tab and the case_pulse tool both read it, so they cannot disagree).
