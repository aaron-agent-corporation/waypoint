const WAYPOINT_CORE_PACKAGE = 'waypoint-core'

export const WAYPOINT_FOLDER_HOST_PACKAGE = '@waypoint/folder-host'

export interface WaypointFolderHostInfo {
  readonly packageName: typeof WAYPOINT_FOLDER_HOST_PACKAGE
  readonly corePackage: typeof WAYPOINT_CORE_PACKAGE
}

export function getWaypointFolderHostInfo(): WaypointFolderHostInfo {
  return {
    packageName: WAYPOINT_FOLDER_HOST_PACKAGE,
    corePackage: WAYPOINT_CORE_PACKAGE,
  }
}

export { initWaypointProject } from './project/init.ts'
export type { InitWaypointProjectOptions, InitWaypointProjectResult } from './project/init.ts'
export { readWaypointStatus } from './project/status.ts'
export type { WaypointProjectStatus } from './project/status.ts'
export { findWaypointProjectRoot, getWaypointProjectPaths, waypointConfigExists, WAYPOINT_DIR_NAME } from './project/root.ts'
export type { WaypointProjectPaths } from './project/root.ts'
export {
  createWaypointProjectConfig,
  parseWaypointProjectConfig,
  readWaypointProjectConfig,
  serializeWaypointProjectConfig,
} from './project/config.ts'
export type {
  WaypointProjectBackendConfig,
  WaypointProjectConfig,
  WaypointProjectGasCityRuntimeConfig,
  WaypointRecipeRuntimeMode,
  WaypointRouteBackendMode,
} from './project/config.ts'
export { loadBundledWaypointCatalog, formatCatalogEntryWarning } from './catalog/bundled.ts'
export { loadWorkspaceWaypointCatalog } from './catalog/workspace.ts'
export type {
  BundledWaypointCatalog,
  CatalogEntryError,
  ResolveCatalogQuestRecipesResult,
  WaypointCatalogEntry,
} from './catalog/bundled.ts'
export { installQuestCatalog } from './catalog/install.ts'
export type { InstallQuestCatalogOptions, InstallQuestCatalogResult } from './catalog/install.ts'
export { compileQuestToBeadsGraph } from './beads/compiler.ts'
export type {
  CompileQuestToBeadsGraphInput,
  WaypointBeadsArtifactSpec,
  WaypointBeadsDependencySpec,
  WaypointBeadsDependencyType,
  WaypointBeadsExternalSideEffects,
  WaypointBeadsGraph,
  WaypointBeadsIssueKind,
  WaypointBeadsIssueSpec,
  WaypointBeadsIssueType,
  WaypointBeadsMetadata,
  WaypointBeadsPolicy,
  WaypointBeadsRecipeRuntimeSpec,
  WaypointBeadsScaffoldRef,
  WaypointBeadsSourceRef,
  WaypointBeadsSubject,
} from './beads/compiler.ts'
export {
  compileQuestToBeadsFormula,
  compileWaypointCatalogToBeadsFormulas,
  exportWaypointCatalogAsBeadsFormulaFiles,
  serializeWaypointBeadsFormulaJson,
} from './beads/formula.ts'
export type {
  CompileWaypointCatalogToBeadsFormulasInput,
  WaypointBeadsFormula,
  WaypointBeadsFormulaFileSpec,
  WaypointBeadsFormulaStep,
  WaypointBeadsFormulaStepType,
  WaypointBeadsFormulaType,
  WaypointBeadsFormulaVar,
} from './beads/formula.ts'
export { listRunnableWaypointBeadsRecipeExecutions, planWaypointBeadsRecipeExecution } from './beads/execution.ts'
export type {
  WaypointBeadsRecipeExecutionAction,
  WaypointBeadsRecipeExecutionBlockReason,
  WaypointBeadsRecipeExecutionPlan,
  WaypointBeadsRecipeRuntimePolicy,
  WaypointBeadsRuntimeExternalSideEffects,
} from './beads/execution.ts'
export { verifyWaypointBeadsTaskCompletion } from './beads/verification.ts'
export type {
  VerifyWaypointBeadsTaskCompletionInput,
  WaypointBeadsArtifactVerificationResult,
  WaypointBeadsArtifactVerificationStatus,
  WaypointBeadsArtifactVerifier,
  WaypointBeadsTaskCompletionAction,
  WaypointBeadsTaskCompletionBlockReason,
  WaypointBeadsTaskCompletionVerification,
} from './beads/verification.ts'
export { instantiateWaypointRouteInBeads } from './beads/instantiate.ts'
export type {
  InstantiateWaypointRouteInBeadsInput,
  WaypointBeadsDependencyCreateInput,
  WaypointBeadsInstantiatedDependency,
  WaypointBeadsInstantiatedIssue,
  WaypointBeadsInstantiationResult,
  WaypointBeadsIssueClient,
  WaypointBeadsIssueCreateInput,
  WaypointBeadsIssueCreateResult,
} from './beads/instantiate.ts'
export { SpawnWaypointBeadsCliCommandRunner, WaypointBeadsCliCommandError, WaypointBeadsCliIssueClient } from './beads/cli-client.ts'
export type {
  WaypointBeadsCliCommandInput,
  WaypointBeadsCliCommandOutput,
  WaypointBeadsCliCommandRunner,
  WaypointBeadsCliIssueClientConfig,
  WaypointBeadsIssueCloseInput,
  WaypointBeadsIssueCommentReader,
  WaypointBeadsIssueCommentInput,
  WaypointBeadsIssueCommentSnapshot,
  WaypointBeadsIssueMetadataMutationClient,
  WaypointBeadsIssueMetadataUpdateInput,
  WaypointBeadsIssueMutationClient,
  WaypointBeadsIssueSnapshotListResult,
  WaypointBeadsIssueSnapshotReader,
  WaypointBeadsIssueStatusUpdateInput,
} from './beads/cli-client.ts'
export {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  initializeWaypointBeadsWorkspace,
} from './beads/workspace.ts'
export type {
  WaypointBeadsWorkspaceOptions,
  WaypointBeadsWorkspaceReadiness,
  WaypointBeadsWorkspaceReadinessStatus,
} from './beads/workspace.ts'
export {
  diagnoseWaypointGasCityState,
  formatWaypointGasCityErrorEnvelope,
  SpawnWaypointGasCityCommandRunner,
  WaypointGasCityCliAdapter,
  WaypointGasCityCliCommandError,
} from './gascity/cli-adapter.ts'
export { inspectWaypointGasCityRoute } from './gascity/diagnostics.ts'
export { delegateWaypointRouteToGasCity, formatWaypointGasCityPreflightFailure } from './gascity/delegate.ts'
export {
  formatWaypointGasCityMetadataVerificationFailure,
  repairWaypointGasCityRouteMetadata,
  verifyWaypointGasCityRouteMetadata,
} from './gascity/metadata.ts'
export type {
  WaypointGasCityAddRigInput,
  WaypointGasCityCliAdapterConfig,
  WaypointGasCityCommandInput,
  WaypointGasCityCommandOutput,
  WaypointGasCityCommandResult,
  WaypointGasCityCommandRunner,
  WaypointGasCityConvoyResult,
  WaypointGasCityCreateConvoyInput,
  WaypointGasCityDiagnostic,
  WaypointGasCityDiagnosticCode,
  WaypointGasCityDiagnosticInput,
  WaypointGasCityErrorEnvelope,
  WaypointGasCityEventObservation,
  WaypointGasCityEventPage,
  WaypointGasCityEventsInput,
  WaypointGasCityHookItem,
  WaypointGasCityInitCityInput,
  WaypointGasCityPreflight,
  WaypointGasCityPreflightInput,
  WaypointGasCityPreflightTool,
  WaypointGasCityRegisterCityInput,
  WaypointGasCityScopeInput,
  WaypointGasCitySession,
  WaypointGasCitySessionList,
  WaypointGasCitySessionListInput,
  WaypointGasCitySessionObservation,
  WaypointGasCitySlingBeadInput,
  WaypointGasCitySlingResult,
  WaypointGasCityStatus,
  WaypointGasCityStatusInput,
  WaypointGasCityTaskObservation,
  WaypointGasCityToolCheck,
  WaypointGasCityToolCheckSpec,
  WaypointGasCityVersion,
} from './gascity/cli-adapter.ts'
export type {
  DelegateWaypointRouteToGasCityInput,
  DelegateWaypointRouteToGasCityResult,
  WaypointGasCityDelegatableRoute,
  WaypointGasCityRouteRuntime,
} from './gascity/delegate.ts'
export type {
  InspectWaypointGasCityRouteInput,
  InspectWaypointGasCityRouteResult,
  WaypointGasCityDiagnosticsRuntime,
  WaypointGasCityTaskDiagnosticSnapshot,
} from './gascity/diagnostics.ts'
export type {
  RepairWaypointGasCityRouteMetadataInput,
  VerifyWaypointGasCityRouteMetadataInput,
  WaypointGasCityRouteMetadataRepairClient,
  WaypointGasCityRouteMetadataRepairPolicy,
  WaypointGasCityRouteMetadataVerification,
} from './gascity/metadata.ts'
export {
  approveWaypointBeadsRouteGate,
  pauseWaypointBeadsRoute,
  rejectWaypointBeadsRouteGate,
  resolveWaypointBeadsRouteBlocker,
  resumeWaypointBeadsRoute,
} from './beads/transitions.ts'
export type { WaypointBeadsTransitionOptions } from './beads/transitions.ts'
export { checkWaypointCatalogBeadsReadiness } from './beads/readiness.ts'
export type {
  WaypointBeadsCatalogReadinessFinding,
  WaypointBeadsCatalogReadinessFindingCode,
  WaypointBeadsCatalogReadinessFindingSeverity,
  WaypointBeadsCatalogReadinessReport,
  WaypointBeadsCatalogReadinessSummary,
} from './beads/readiness.ts'
export { reconstructWaypointRunFromBeads } from './beads/reconstruct.ts'
export type {
  ReconstructWaypointRunFromBeadsInput,
  WaypointBeadsDependencySnapshot,
  WaypointBeadsIssueDependencySnapshot,
  WaypointBeadsIssueSnapshot,
  WaypointBeadsRouteRun,
  WaypointBeadsRunProgress,
  WaypointBeadsRunReconstruction,
  WaypointBeadsRunStatus,
  WaypointBeadsRunTask,
  WaypointBeadsRunTaskStatus,
  WaypointBeadsSnapshotStatus,
} from './beads/reconstruct.ts'
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
export { approveRouteGate, pauseWaypointRoute, rejectRouteGate, resolveWaypointRouteBlocker, resumeWaypointRoute } from './routes/state.ts'
export { startQuestRoute } from './routes/start.ts'
export type { StartQuestRouteOptions, StartedQuestRoute, StartedQuestRouteBeadsSummary } from './routes/start.ts'
export { startAdhocRoute, AdhocManifestError } from './routes/start-adhoc.ts'
export type { StartAdhocRouteOptions, StartedAdhocRoute } from './routes/start-adhoc.ts'
export { getWaypointRuntimeRoute, getWaypointRuntimeTask, listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from './routes/read-model.ts'
export type { ListWaypointRuntimeTasksOptions, WaypointRuntimeReadOptions } from './routes/read-model.ts'
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
export { getWaypointTask, listWaypointTasks, materializeQuestTasks, updateWaypointTask } from './tasks/store.ts'
export type { WaypointFolderTask, WaypointFolderTaskKind, WaypointFolderTaskState, WaypointFolderTaskStatus } from './tasks/types.ts'
export { listWaypointAutopilotRuns, runWaypointAutopilot } from './autopilot/run.ts'
export { NullRecipeRuntime } from './runtime/null-runtime.ts'
export type {
  RunWaypointAutopilotOptions,
  RunWaypointAutopilotResult,
  WaypointAutopilotRunPage,
  WaypointAutopilotRunRecord,
  WaypointAutopilotRunStatus,
} from './autopilot/types.ts'
export { appendTaskDiscussionMessage, readTaskDiscussionMessages } from './discussion/store.ts'
export type { WaypointTaskDiscussionRuntimeOptions } from './discussion/store.ts'
export { LocalRecipeRuntime } from './runtime/local-runtime.ts'
export { runReferralPackageBuilder, runReferralPackageBuilderFromStdin } from './runtime/referral-package-builder.ts'
export {
  FIRMVAULT_REQUIRED_CASE_PATHS,
  FIRMVAULT_STARTER_CASE_PATHS,
  inspectFirmVaultCaseFolder,
} from './firmvault/case-folder.ts'
export type { FirmVaultCaseFolderInspection } from './firmvault/case-folder.ts'
export { bootstrapFirmVaultCase, createFirmVaultCaseFolder } from './firmvault/bootstrap.ts'
export type {
  FirmVaultCaseActivationInput,
  FirmVaultCaseActivationResult,
  FirmVaultCaseBootstrapFolderResult,
  FirmVaultCaseBootstrapInput,
} from './firmvault/bootstrap.ts'
export {
  addFirmVaultDocument,
  FIRMVAULT_DOCUMENT_HANDOFF_STATUSES,
  FIRMVAULT_DOCUMENT_HANDOFF_SYSTEM,
  FIRMVAULT_DOCUMENT_KINDS,
  updateFirmVaultDocumentHandoff,
} from './firmvault/documents.ts'
export type {
  AddFirmVaultDocumentInput,
  AddFirmVaultDocumentResult,
  FirmVaultDocumentHandoff,
  FirmVaultDocumentHandoffStatus,
  FirmVaultDocumentIndexEntry,
  FirmVaultDocumentKind,
  UpdateFirmVaultDocumentHandoffInput,
  UpdateFirmVaultDocumentHandoffResult,
} from './firmvault/documents.ts'
export { inspectFirmVaultOperatorReadiness } from './firmvault/doctor.ts'
export type {
  FirmVaultOperatorDoctorCheck,
  FirmVaultOperatorDoctorCheckStatus,
  FirmVaultOperatorDoctorOptions,
  FirmVaultOperatorDoctorResult,
  FirmVaultOperatorDoctorUpgradePlan,
  FirmVaultOperatorDoctorUpgradeStep,
} from './firmvault/doctor.ts'
export {
  checkFirmVaultEvidencePath,
  FIRMVAULT_CASE_STATE_FILES,
  FIRMVAULT_LANDMARK_SLUGS,
  getFirmVaultCaseGuidance,
  initFirmVaultCaseState,
  readFirmVaultCaseState,
  readFirmVaultLandmarkProjection,
  setFirmVaultCaseFact,
} from './firmvault/state.ts'
export { FIRMVAULT_FACT_DEFINITIONS, getFirmVaultFactDefinition } from './firmvault/facts.ts'
export {
  adoptFirmVaultLegacyCase,
  inspectFirmVaultLegacyCase,
  previewFirmVaultCaseAdoption,
} from './firmvault/adoption.ts'
export type { FirmVaultFactDefinition, FirmVaultStateSection } from './firmvault/facts.ts'
export type {
  FirmVaultCaseGuidanceAction,
  FirmVaultCaseGuidanceResult,
  FirmVaultCaseStateSectionName,
  FirmVaultCaseType,
  FirmVaultEvidencePathCheck,
  FirmVaultEvidenceRef,
  FirmVaultLandmarkCounts,
  FirmVaultLandmarkMap,
  FirmVaultLandmarkProjection,
  FirmVaultLandmarkSlug,
  FirmVaultLandmarkState,
  InitFirmVaultCaseStateOptions,
  InitFirmVaultCaseStateResult,
  SetFirmVaultCaseFactInput,
  SetFirmVaultCaseFactResult,
} from './firmvault/state.ts'
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
