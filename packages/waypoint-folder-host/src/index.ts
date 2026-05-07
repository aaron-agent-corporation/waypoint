import { WAYPOINT_CORE_PACKAGE } from '@waypoint/core'

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
