import type { WaypointBeadsArtifactSpec } from './compiler.ts'
import type { WaypointBeadsRunTask } from './reconstruct.ts'

export type WaypointBeadsArtifactVerificationStatus = 'present' | 'missing' | 'invalid'
export type WaypointBeadsTaskCompletionAction = 'allow_close' | 'block_close'
export type WaypointBeadsTaskCompletionBlockReason =
  | 'human_review_required'
  | 'wait_condition_pending'
  | 'artifact_verifier_required'
  | 'required_artifacts_missing'
  | 'required_artifacts_invalid'

export interface WaypointBeadsArtifactVerificationResult {
  readonly path: string
  readonly status: WaypointBeadsArtifactVerificationStatus
  readonly reason?: string
}

export interface WaypointBeadsArtifactVerifier {
  verifyArtifact(
    artifact: WaypointBeadsArtifactSpec,
    task: WaypointBeadsRunTask,
  ): Promise<WaypointBeadsArtifactVerificationResult>
}

export interface VerifyWaypointBeadsTaskCompletionInput {
  readonly approved_gate_ids?: readonly string[]
  readonly resolved_wait_ids?: readonly string[]
  readonly artifactVerifier?: WaypointBeadsArtifactVerifier
}

export interface WaypointBeadsTaskCompletionVerification {
  readonly action: WaypointBeadsTaskCompletionAction
  readonly task: WaypointBeadsRunTask
  readonly block_reasons: readonly WaypointBeadsTaskCompletionBlockReason[]
  readonly artifacts: readonly WaypointBeadsArtifactVerificationResult[]
}

export async function verifyWaypointBeadsTaskCompletion(
  task: WaypointBeadsRunTask,
  input: VerifyWaypointBeadsTaskCompletionInput = {},
): Promise<WaypointBeadsTaskCompletionVerification> {
  const blockReasons: WaypointBeadsTaskCompletionBlockReason[] = []

  if (task.kind === 'gate' && !input.approved_gate_ids?.includes(task.beads_id)) {
    blockReasons.push('human_review_required')
  }
  if (task.kind === 'wait' && !input.resolved_wait_ids?.includes(task.beads_id)) {
    blockReasons.push('wait_condition_pending')
  }

  const artifacts = task.metadata.waypoint.artifacts ?? []
  const artifactResults: WaypointBeadsArtifactVerificationResult[] = []
  if (artifacts.length > 0 && !input.artifactVerifier) {
    blockReasons.push('artifact_verifier_required')
  } else if (input.artifactVerifier) {
    for (const artifact of artifacts) {
      artifactResults.push(await input.artifactVerifier.verifyArtifact(artifact, task))
    }
  }

  if (artifactResults.some((artifact) => artifact.status === 'missing')) {
    blockReasons.push('required_artifacts_missing')
  }
  if (artifactResults.some((artifact) => artifact.status === 'invalid')) {
    blockReasons.push('required_artifacts_invalid')
  }

  return {
    action: blockReasons.length === 0 ? 'allow_close' : 'block_close',
    task,
    block_reasons: dedupe(blockReasons),
    artifacts: artifactResults,
  }
}

function dedupe<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values))
}
