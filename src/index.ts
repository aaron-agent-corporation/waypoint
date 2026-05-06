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
