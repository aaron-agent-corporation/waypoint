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
