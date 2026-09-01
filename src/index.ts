export const WAYPOINT_CORE_PACKAGE = 'runner-core'
export { makeErrorEnvelope } from './envelope/error-envelope.ts'
export type { WaypointErrorEnvelope } from './envelope/error-envelope.ts'
export { normalizeValidationDetails } from './envelope/validation-details.ts'
export type { ValidationIssue, NormalizedValidationDetail } from './envelope/validation-details.ts'
export { parseWaypointCommand } from './commands/parser.ts'
export type { WaypointCommandName, WaypointParsedCommand } from './commands/parser.ts'
export { buildWaypointRouteKey } from './routes/route-key.ts'
export type { BuildWaypointRouteKeyInput } from './routes/route-key.ts'
export {
  normalizeWaypointScope,
  isWaypointSubjectType,
  WAYPOINT_SUBJECT_TYPES,
  WAYPOINT_COMPAT_SUBJECT_TYPES,
} from './routes/scope.ts'
export type { NormalizeWaypointScopeInput, WaypointScope } from './routes/scope.ts'
export { hasWaypointAutopilotProgress } from './autopilot/progress.ts'
export type { WaypointAutopilotProgressInput } from './autopilot/progress.ts'
export {
  slugifyWaypointAgent,
  buildWaypointTaskDiscussionConversationId,
  isStrictWaypointTaskDiscussionConversationId,
} from './discussion/conversation.ts'
export {
  parseWaypointJsonObject,
  parseWaypointTaskDiscussionMetadata,
  isWaypointTaskDiscussionEnabled,
  mergeWaypointTaskDiscussionMetadata,
  parseWaypointWorkflowMetadataNumber,
  buildWaypointTaskDiscussionMessageMetadata,
  resolveWaypointTaskDiscussionStatus,
  resolveWaypointTaskDiscussionAgent,
  normalizeWaypointTaskDiscussionListLimit,
  normalizeWaypointTaskDiscussionMessageContent,
  parseWaypointDiscussionAutoResponseEnvFlag,
  buildWaypointTaskDiscussionStartMetadata,
  resolveWaypointDiscussionAutoResponse,
} from './discussion/metadata.ts'
export type {
  WaypointTaskDiscussionStatus,
  WaypointTaskDiscussionAutoResponseMetadata,
  WaypointDiscussionAutoResponseDecision,
  WaypointDiscussionAutoResponseSkipReason,
  WaypointTaskDiscussionMetadata,
  WaypointTaskDiscussionMessageTask,
  WaypointTaskDiscussionMessageMetadata,
} from './discussion/metadata.ts'

export { WaypointSubjectType } from './contracts/system.ts'
export type { WaypointSubjectType as WaypointSubjectTypeValue, IClock, IIdGenerator } from './contracts/system.ts'
export type { IEventBus } from './contracts/event-bus.ts'

export {
  WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES,
  isWaypointDiscussionMessageAuthoredBy,
} from './discussion/auto-response-contract.ts'
export type {
  WaypointDiscussionMessageAuthoredBy,
  WaypointDiscussionAutoResponseHistoryEntry,
  WaypointDiscussionAutoResponseRequestPayload,
} from './discussion/auto-response-contract.ts'

export {
  parseQuestManifest,
  isQuestManifest,
  questAvailability,
  questIsAvailable,
  QUEST_AVAILABILITY_VALUES,
} from './quests/manifest.ts'
export type {
  QuestAvailability,
  QuestManifest,
  QuestScaffolds,
  QuestScaffoldWorkstream,
  QuestScaffoldMilestone,
  QuestScaffoldPhase,
  QuestScaffoldPlan,
  QuestManifestParseResult,
  QuestManifestParseError,
  QuestManifestParseErrorCode,
} from './quests/manifest.ts'

export {
  parseRecipeManifest,
  isRecipeManifest,
  runtimeKindConsumesTools,
  toolsConsumingRuntimeKinds,
} from './recipes/manifest.ts'
export type {
  RecipeManifest,
  RecipeRuntimeHints,
  RecipeManifestParseResult,
  RecipeManifestParseError,
  RecipeManifestParseErrorCode,
} from './recipes/manifest.ts'

export { createQuestRegistry } from './quests/registry.ts'
export type {
  QuestRegistry,
  QuestRegistryAddResult,
  QuestRegistryAddErrorCode,
} from './quests/registry.ts'

export { createRecipeRegistry } from './recipes/registry.ts'
export type {
  RecipeRegistry,
  RecipeRegistryAddResult,
  RecipeRegistryAddErrorCode,
} from './recipes/registry.ts'

export { createHandoffManifestRegistry } from './handoffs/registry.ts'
export type {
  HandoffManifestRegistry,
  HandoffManifestRegistryAddResult,
  HandoffManifestRegistryAddErrorCode,
} from './handoffs/registry.ts'

export { resolveQuestRecipes, resolveQuestHandoffManifests } from './quests/resolve.ts'
export type {
  ResolveQuestRecipesResult,
  ResolveQuestRecipesError,
  ResolveQuestHandoffManifestsResult,
  ResolveQuestHandoffManifestsError,
} from './quests/resolve.ts'

export { loadQuestsFromDirectory } from './quests/loader.ts'
export type { LoadQuestsResult, LoadQuestError, LoadQuestErrorCode } from './quests/loader.ts'

export { loadRecipesFromDirectory } from './recipes/loader.ts'
export type { LoadRecipesResult, LoadRecipeError, LoadRecipeErrorCode } from './recipes/loader.ts'

export { parseOperatorManifest, isOperatorManifest } from './operators/manifest.ts'
export type {
  OperatorManifest,
  OperatorInstructionLayer,
  OperatorToolRef,
  OperatorHandoffRef,
  OperatorManifestParseResult,
  OperatorManifestParseError,
  OperatorManifestParseErrorCode,
} from './operators/manifest.ts'

export { parseHandoffManifest, isHandoffManifest } from './handoffs/manifest.ts'
export type {
  HandoffManifest,
  HandoffStep,
  HandoffManifestParseResult,
  HandoffManifestParseError,
  HandoffManifestParseErrorCode,
} from './handoffs/manifest.ts'

export { loadHandoffManifestsFromDirectory, loadBundledHandoffManifests } from './handoffs/loader.ts'
export type {
  LoadHandoffManifestsResult,
  LoadHandoffError,
  LoadHandoffErrorCode,
  HandoffManifestEntry,
} from './handoffs/loader.ts'

export { loadOperatorsFromDirectory, loadBundledOperators } from './operators/loader.ts'
export type {
  LoadOperatorsResult,
  OperatorManifestEntry,
  LoadOperatorError,
  LoadOperatorErrorCode,
} from './operators/loader.ts'

export { listWaypointToolsForOperator, explainWaypointTool, getWaypointToolRegistry } from './tools/registry.ts'
export type {
  WaypointToolDefinition,
  WaypointToolInput,
  WaypointToolSideEffectClass,
  ListWaypointToolsResult,
  ExplainWaypointToolResult,
} from './tools/registry.ts'

export { resolveOperatorInstructions } from './operators/instructions.ts'
export type {
  OperatorInstructionResolution,
  ResolvedOperatorInstructionLayer,
  ResolveOperatorInstructionsOptions,
} from './operators/instructions.ts'

export { createAuthoringDraft, validateAuthoringDraft } from './authoring/draft.ts'
export type {
  WaypointAuthoringDraft,
  AuthoringKind,
  AuthoringSource,
  AuthoringApprovalStatus,
  AuthoringGeneratedFile,
  AuthoringQuestionAnswer,
  AuthoringApproach,
  CreateAuthoringDraftInput,
  ValidateAuthoringDraftResult,
} from './authoring/draft.ts'

export { getAuthoringQuestionnaire } from './authoring/questionnaires.ts'
export type { AuthoringQuestionnaire, AuthoringQuestionGroup, AuthoringQuestion } from './authoring/questionnaires.ts'

export { generateAuthoringDesignSpec, reviewAuthoringDesignSpec } from './authoring/design-spec-generator.ts'
export type {
  GenerateAuthoringDesignSpecInput,
  GenerateAuthoringDesignSpecResult,
  AuthoringDesignReview,
  AuthoringLifecycleMap,
} from './authoring/design-spec-generator.ts'

export { generateAuthoringRecipeDraft } from './authoring/recipe-generator.ts'
export type {
  GenerateAuthoringRecipeDraftInput,
  GenerateAuthoringRecipeDraftResult,
  AuthoringManifestDraftValidation,
} from './authoring/recipe-generator.ts'

export { generateAuthoringQuestDraft } from './authoring/quest-generator.ts'
export type {
  GenerateAuthoringQuestDraftInput,
  GenerateAuthoringQuestDraftResult,
  AuthoringQuestPhaseDraft,
  AuthoringQuestTaskDraft,
} from './authoring/quest-generator.ts'

export { generateAuthoringHandoffDraft } from './authoring/handoff-generator.ts'
export type {
  GenerateAuthoringHandoffDraftInput,
  GenerateAuthoringHandoffDraftResult,
  AuthoringHandoffStepDraft,
} from './authoring/handoff-generator.ts'

export { WIZARD_DOMAINS, createWizardSourcePointer, isSafeWizardRelativePath, isWizardDomain } from './wizard/types.ts'
export {
  assertWithinRoot,
  safeShadowRelativePath,
  safeWizardArtifactPath,
  slugifyWizardPathSegment,
} from './wizard/paths.ts'
export { classifyWizardSourceFile } from './wizard/classifier.ts'
export { scanWizardSource } from './wizard/scan.ts'
export type { ScanWizardSourceInput } from './wizard/scan.ts'
export { createWizardShadows } from './wizard/shadows.ts'
export type { CreateWizardShadowsInput, CreateWizardShadowsResult } from './wizard/shadows.ts'
export {
  buildWizardOrganizationPlan,
  createWizardOrganizedDocumentEntry,
  writeWizardOrganizationPlan,
  writeWizardOrganizedCasePackage,
} from './wizard/organize.ts'
export type {
  BuildWizardOrganizationPlanInput,
  CreateWizardOrganizedDocumentEntryInput,
  WriteWizardOrganizationPlanInput,
  WriteWizardOrganizationPlanResult,
  WriteWizardOrganizedCasePackageInput,
  WriteWizardOrganizedCasePackageResult,
} from './wizard/organize.ts'
export {
  generateWizardQuestions,
  nextWizardQuestion,
  readWizardAnswers,
  readWizardQuestions,
  recordWizardAnswer,
  writeWizardQuestions,
} from './wizard/questions.ts'
export type {
  GenerateWizardQuestionsInput,
  ReadWizardAnswersInput,
  ReadWizardQuestionsInput,
  RecordWizardAnswerInput,
  RecordWizardAnswerResult,
  WriteWizardQuestionsInput,
  WriteWizardQuestionsResult,
} from './wizard/questions.ts'
export {
  approveWizardProposedFacts,
  buildWizardAdoptionPlan,
  writeWizardAdoptionPlan,
} from './wizard/plan.ts'
export type {
  BuildWizardAdoptionPlanInput,
  WriteWizardAdoptionPlanInput,
  WriteWizardAdoptionPlanResult,
} from './wizard/plan.ts'
export {
  parseWizardShadowMarkdown,
  serializeWizardShadowMarkdown,
} from './wizard/shadow-frontmatter.ts'
export type {
  ParsedWizardShadowMarkdown,
  SerializeWizardShadowMarkdownInput,
} from './wizard/shadow-frontmatter.ts'
export type {
  WizardAdoptionPlan,
  WizardAmbiguity,
  WizardAnswer,
  WizardClassification,
  WizardConfidence,
  WizardDomain,
  WizardPiiMetadata,
  WizardPlanApprovalSummary,
  WizardPlanClassificationSummary,
  WizardPlanQuestionAnswerSummary,
  WizardPlanShadowMapEntry,
  WizardPlanSourceInventory,
  WizardProposedFact,
  WizardOrganizeCopyDecision,
  WizardOrganizeCopyMode,
  WizardOrganizeCopyStatus,
  WizardOrganizeDomainBoundary,
  WizardOrganizedDocumentEntry,
  WizardOrganizationPlan,
  WizardQuestion,
  WizardQuestionStatus,
  WizardReviewStatus,
  WizardScanResult,
  WizardShadowDocumentFrontmatter,
  WizardShadowRecord,
  WizardSourceFile,
  WizardSourcePointer,
} from './wizard/types.ts'
