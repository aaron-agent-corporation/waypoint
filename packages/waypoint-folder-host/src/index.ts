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
export { getWaypointProjectPaths, waypointConfigExists, WAYPOINT_DIR_NAME } from './project/root.ts'
export type { WaypointProjectPaths } from './project/root.ts'
export {
  createWaypointProjectConfig,
  parseWaypointProjectConfig,
  serializeWaypointProjectConfig,
} from './project/config.ts'
export type { WaypointProjectConfig } from './project/config.ts'
export { loadBundledWaypointCatalog } from './catalog/bundled.ts'
export type {
  BundledWaypointCatalog,
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
export { approveRouteGate, pauseWaypointRoute, rejectRouteGate, resumeWaypointRoute } from './routes/state.ts'
export { startQuestRoute } from './routes/start.ts'
export type { StartQuestRouteOptions, StartedQuestRoute } from './routes/start.ts'
export { applyQuestScaffold } from './quests/scaffold.ts'
export type { AppliedQuestScaffoldSummary, ApplyQuestScaffoldOptions } from './quests/scaffold.ts'
export type {
  CreateWaypointRouteInput,
  WaypointFolderRoute,
  WaypointFolderRouteStatus,
  WaypointFolderRouteSubject,
} from './routes/types.ts'
export { appendRouteEvent, readRouteEvents } from './events/jsonl.ts'
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
