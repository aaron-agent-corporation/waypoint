const WAYPOINT_CORE_PACKAGE = 'waypoint-core'

export const WAYPOINT_ENGINE_HOST_PACKAGE = '@waypoint/engine-host'

export interface EngineHostInfo {
  readonly packageName: typeof WAYPOINT_ENGINE_HOST_PACKAGE
  readonly corePackage: typeof WAYPOINT_CORE_PACKAGE
}

export function getEngineHostInfo(): EngineHostInfo {
  return {
    packageName: WAYPOINT_ENGINE_HOST_PACKAGE,
    corePackage: WAYPOINT_CORE_PACKAGE,
  }
}
