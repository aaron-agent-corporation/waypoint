import type { WaypointBeadsIssueMutationClient, WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import type { WaypointBeadsRecipeRuntimePolicy } from '../beads/execution.ts'
import type { WaypointBeadsArtifactVerifier } from '../beads/verification.ts'

export type WaypointAutopilotRunStatus = 'complete' | 'blocked' | 'iteration_cap' | 'failed'

export interface WaypointAutopilotRunRecord {
  readonly id: string
  readonly route_id: string
  readonly status: WaypointAutopilotRunStatus
  readonly iterations: number
  readonly completed_tasks: readonly string[]
  readonly blocked_node: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly metadata?: Record<string, unknown>
}

export interface WaypointAutopilotRunPage {
  readonly items: readonly WaypointAutopilotRunRecord[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface RunWaypointAutopilotOptions {
  readonly routeId?: string
  readonly maxIterations?: number
  readonly now?: Date
  readonly beadsReader?: WaypointBeadsIssueSnapshotReader
  readonly beadsMutator?: WaypointBeadsIssueMutationClient
  readonly artifactVerifier?: WaypointBeadsArtifactVerifier
  readonly beadsRuntimePolicy?: WaypointBeadsRecipeRuntimePolicy
}

export interface RunWaypointAutopilotResult {
  readonly run: WaypointAutopilotRunRecord
  readonly status: WaypointAutopilotRunStatus
  readonly routeId: string
  readonly iterations: number
  readonly completedTasks: readonly string[]
  readonly blockedNode: string | null
}
