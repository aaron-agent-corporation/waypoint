export const WAYPOINT_CORE_PACKAGE = 'waypoint-core'
export { makeErrorEnvelope } from './envelope/error-envelope'
export { normalizeValidationDetails } from './envelope/validation-details'
export type { ValidationIssue, NormalizedValidationDetail } from './envelope/validation-details'
export { parseWaypointCommand } from './commands/parser'
export type { WaypointCommandName, WaypointParsedCommand } from './commands/parser'
export { buildWaypointRouteKey } from './routes/route-key'
export type { BuildWaypointRouteKeyInput } from './routes/route-key'
export {
  normalizeWaypointScope,
  isWaypointSubjectType,
  WAYPOINT_SUBJECT_TYPES,
  WAYPOINT_COMPAT_SUBJECT_TYPES,
} from './routes/scope'
export type { NormalizeWaypointScopeInput, WaypointScope } from './routes/scope'
export { hasWaypointAutopilotProgress } from './autopilot/progress'
export type { WaypointAutopilotProgressInput } from './autopilot/progress'
export {
  slugifyWaypointAgent,
  buildWaypointTaskDiscussionConversationId,
  isStrictWaypointTaskDiscussionConversationId,
} from './discussion/conversation'
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
} from './discussion/metadata'
export type {
  WaypointTaskDiscussionStatus,
  WaypointTaskDiscussionAutoResponseMetadata,
  WaypointDiscussionAutoResponseDecision,
  WaypointDiscussionAutoResponseSkipReason,
  WaypointTaskDiscussionMetadata,
  WaypointTaskDiscussionMessageTask,
  WaypointTaskDiscussionMessageMetadata,
} from './discussion/metadata'

export { WaypointSubjectType } from './contracts/system'
export type { WaypointSubjectType as WaypointSubjectTypeValue, IClock, IIdGenerator } from './contracts/system'
export type { IWaypointStore, WaypointRouteRecord, WaypointEventRecord } from './contracts/store'
export type { IWaypointAuthz, WaypointActor } from './contracts/authz'
export type { IEventBus } from './contracts/event-bus'
export type { IRecipeRuntime, RecipeRunRequest, RecipeRunHandle } from './contracts/recipe-runtime'

export {
  WAYPOINT_DISCUSSION_MESSAGE_AUTHORED_BY_VALUES,
  isWaypointDiscussionMessageAuthoredBy,
} from './discussion/auto-response-contract'
export type {
  WaypointDiscussionMessageAuthoredBy,
  WaypointDiscussionAutoResponseHistoryEntry,
  WaypointDiscussionAutoResponseRequestPayload,
} from './discussion/auto-response-contract'

export { parseQuestManifest, isQuestManifest } from './quests/manifest'
export type {
  QuestManifest,
  QuestScaffolds,
  QuestScaffoldWorkstream,
  QuestScaffoldMilestone,
  QuestScaffoldPhase,
  QuestScaffoldPlan,
  QuestManifestParseResult,
  QuestManifestParseError,
  QuestManifestParseErrorCode,
} from './quests/manifest'

export { parseRecipeManifest, isRecipeManifest } from './recipes/manifest'
export type {
  RecipeManifest,
  RecipeRuntimeHints,
  RecipeManifestParseResult,
  RecipeManifestParseError,
  RecipeManifestParseErrorCode,
} from './recipes/manifest'

export { createQuestRegistry } from './quests/registry'
export type {
  QuestRegistry,
  QuestRegistryAddResult,
  QuestRegistryAddErrorCode,
} from './quests/registry'

export { createRecipeRegistry } from './recipes/registry'
export type {
  RecipeRegistry,
  RecipeRegistryAddResult,
  RecipeRegistryAddErrorCode,
} from './recipes/registry'

export { resolveQuestRecipes } from './quests/resolve'
export type { ResolveQuestRecipesResult, ResolveQuestRecipesError } from './quests/resolve'

export { loadQuestsFromDirectory } from './quests/loader'
export type { LoadQuestsResult, LoadQuestError, LoadQuestErrorCode } from './quests/loader'

export { loadRecipesFromDirectory } from './recipes/loader'
export type { LoadRecipesResult, LoadRecipeError, LoadRecipeErrorCode } from './recipes/loader'

export { parseOperatorManifest, isOperatorManifest } from './operators/manifest'
export type {
  OperatorManifest,
  OperatorInstructionLayer,
  OperatorToolRef,
  OperatorHandoffRef,
  OperatorManifestParseResult,
  OperatorManifestParseError,
  OperatorManifestParseErrorCode,
} from './operators/manifest'

export { loadOperatorsFromDirectory, loadBundledOperators } from './operators/loader'
export type {
  LoadOperatorsResult,
  OperatorManifestEntry,
  LoadOperatorError,
  LoadOperatorErrorCode,
} from './operators/loader'

export { listWaypointToolsForOperator, explainWaypointTool, getWaypointToolRegistry } from './tools/registry'
export type {
  WaypointToolDefinition,
  WaypointToolInput,
  WaypointToolSideEffectClass,
  ListWaypointToolsResult,
  ExplainWaypointToolResult,
} from './tools/registry'

export { resolveOperatorInstructions } from './operators/instructions'
export type {
  OperatorInstructionResolution,
  ResolvedOperatorInstructionLayer,
  ResolveOperatorInstructionsOptions,
} from './operators/instructions'

export { createAuthoringDraft, validateAuthoringDraft } from './authoring/draft'
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
} from './authoring/draft'

export { getAuthoringQuestionnaire } from './authoring/questionnaires'
export type { AuthoringQuestionnaire, AuthoringQuestionGroup, AuthoringQuestion } from './authoring/questionnaires'

export { generateAuthoringDesignSpec, reviewAuthoringDesignSpec } from './authoring/design-spec-generator'
export type {
  GenerateAuthoringDesignSpecInput,
  GenerateAuthoringDesignSpecResult,
  AuthoringDesignReview,
  AuthoringLifecycleMap,
} from './authoring/design-spec-generator'

export { generateAuthoringRecipeDraft } from './authoring/recipe-generator'
export type {
  GenerateAuthoringRecipeDraftInput,
  GenerateAuthoringRecipeDraftResult,
  AuthoringManifestDraftValidation,
} from './authoring/recipe-generator'

export { generateAuthoringQuestDraft } from './authoring/quest-generator'
export type {
  GenerateAuthoringQuestDraftInput,
  GenerateAuthoringQuestDraftResult,
  AuthoringQuestPhaseDraft,
  AuthoringQuestTaskDraft,
} from './authoring/quest-generator'
