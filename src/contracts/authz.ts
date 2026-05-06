export interface WaypointActor {
  id: number
  role: 'viewer' | 'operator' | 'admin'
  workspaceId: number
  tenantId: number
}

export interface IWaypointAuthz {
  requireProjectReadAccess(input: {
    actor: WaypointActor
    projectId: number
  }): Promise<void>
  requireProjectMutateAccess(input: {
    actor: WaypointActor
    projectId: number
  }): Promise<void>
}
