import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueMutationClient, type WaypointBeadsIssueSnapshotReader } from './cli-client.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsRunReconstruction, type WaypointBeadsRunTask } from './reconstruct.ts'
import {
  verifyWaypointBeadsTaskCompletion,
  type WaypointBeadsArtifactVerifier,
  type WaypointBeadsTaskCompletionVerification,
} from './verification.ts'

import type { PauseWaypointRouteInput, ResumeWaypointRouteInput, RouteGateDecisionInput, ResolveWaypointRouteBlockerInput } from '../routes/state.ts'
import type { WaypointFolderRoute, WaypointFolderRouteStatus } from '../routes/types.ts'

export interface WaypointBeadsTransitionOptions {
  readonly beadsReader?: WaypointBeadsIssueSnapshotReader
  readonly beadsMutator?: WaypointBeadsIssueMutationClient
  readonly artifactVerifier?: WaypointBeadsArtifactVerifier
}

export async function approveWaypointBeadsRouteGate(
  projectRoot: string,
  input: RouteGateDecisionInput,
): Promise<WaypointFolderRoute> {
  const run = await loadRun(projectRoot, input.routeId, input)
  const gate = requireTask(run, input.node)
  if (gate.kind !== 'gate') throw new Error(`Beads task is not a gate: ${input.node}`)

  const verification = await verifyWaypointBeadsTaskCompletion(gate, {
    approved_gate_ids: [gate.beads_id],
    artifactVerifier: input.artifactVerifier,
  })
  assertAllowsTransition(verification)

  const mutator = mutationClient(projectRoot, input)
  await mutator.addIssueComment({
    id: gate.beads_id,
    text: routeDecisionComment('approved', run.route.id, gate, input.note),
  })
  await mutator.closeIssue({
    id: gate.beads_id,
    reason: `Approved Waypoint gate ${gate.plan_ref} on route ${run.route.id}${input.note ? `: ${input.note}` : ''}`,
  })

  return routeFromRun(run, 'active', input.nextNode ?? gate.plan_ref)
}

export async function rejectWaypointBeadsRouteGate(
  projectRoot: string,
  input: RouteGateDecisionInput,
): Promise<WaypointFolderRoute> {
  const run = await loadRun(projectRoot, input.routeId, input)
  const gate = requireTask(run, input.node)
  if (gate.kind !== 'gate') throw new Error(`Beads task is not a gate: ${input.node}`)

  const mutator = mutationClient(projectRoot, input)
  const note = routeDecisionComment('rejected', run.route.id, gate, input.note)
  await mutator.addIssueComment({ id: gate.beads_id, text: note })
  await mutator.updateIssueStatus({ id: gate.beads_id, status: 'blocked', note })

  return routeFromRun(run, 'blocked', gate.plan_ref)
}

export async function pauseWaypointBeadsRoute(
  projectRoot: string,
  input: PauseWaypointRouteInput,
): Promise<WaypointFolderRoute> {
  const run = await loadRun(projectRoot, input.routeId, input)
  const mutator = mutationClient(projectRoot, input)
  const note = `Waypoint route paused on route ${run.route.id}${input.reason ? `\n\n${input.reason}` : ''}`
  await mutator.addIssueComment({ id: run.route.beads_id, text: note })
  await mutator.updateIssueStatus({ id: run.route.beads_id, status: 'blocked', note })
  return routeFromRun(run, 'blocked', run.route.current_node)
}

export async function resumeWaypointBeadsRoute(
  projectRoot: string,
  input: ResumeWaypointRouteInput,
): Promise<WaypointFolderRoute> {
  const run = await loadRun(projectRoot, input.routeId, input)
  const mutator = mutationClient(projectRoot, input)
  const note = `Waypoint route resumed on route ${run.route.id}`
  await mutator.addIssueComment({ id: run.route.beads_id, text: note })
  await mutator.updateIssueStatus({ id: run.route.beads_id, status: 'open', note })
  return routeFromRun(run, statusAfterRouteIssueResume(run), run.route.current_node)
}

export async function resolveWaypointBeadsRouteBlocker(
  projectRoot: string,
  input: ResolveWaypointRouteBlockerInput,
): Promise<WaypointFolderRoute> {
  const run = await loadRun(projectRoot, input.routeId, input)
  const task = currentResolvableTask(run)
  if (!task) throw new Error(`No supported Beads blocker found for route ${run.route.id}`)
  if (task.kind === 'gate') {
    throw new Error(`Cannot resolve human gate ${task.plan_ref} with resume; use waypoint gate --approve`)
  }

  const verification = await verifyWaypointBeadsTaskCompletion(task, {
    resolved_wait_ids: task.kind === 'wait' ? [task.beads_id] : [],
    artifactVerifier: input.artifactVerifier,
  })
  assertAllowsTransition(verification)

  const mutator = mutationClient(projectRoot, input)
  await mutator.addIssueComment({
    id: task.beads_id,
    text: `Waypoint blocker resolved on route ${run.route.id}: ${task.plan_ref}${input.note ? `\n\n${input.note}` : ''}`,
  })
  await mutator.closeIssue({
    id: task.beads_id,
    reason: `Resolved Waypoint blocker ${task.plan_ref} on route ${run.route.id}${input.note ? `: ${input.note}` : ''}`,
  })

  return routeFromRun(run, 'active', task.plan_ref)
}

async function loadRun(
  projectRoot: string,
  routeId: string,
  options: WaypointBeadsTransitionOptions,
): Promise<WaypointBeadsRunReconstruction> {
  const reader = options.beadsReader ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  return reconstructWaypointRunFromBeads({ ...(await reader.listIssueSnapshots()), routeId })
}

function mutationClient(projectRoot: string, options: WaypointBeadsTransitionOptions): WaypointBeadsIssueMutationClient {
  return options.beadsMutator ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
}

function requireTask(run: WaypointBeadsRunReconstruction, node: string): WaypointBeadsRunTask {
  const task = run.tasks.find((entry) => entry.plan_ref === node || entry.id === node || entry.beads_id === node)
  if (!task) throw new Error(`Beads route task not found for node ${node} on route ${run.route.id}`)
  return task
}

function currentResolvableTask(run: WaypointBeadsRunReconstruction): WaypointBeadsRunTask | null {
  const current = run.route.current_node ? run.tasks.find((task) => task.plan_ref === run.route.current_node) : undefined
  if (current && isSupportedResolvableTask(current)) return current
  return (
    run.tasks.find((task) => task.status === 'open' && (task.kind === 'wait' || task.kind === 'gate')) ??
    run.tasks.find((task) => task.status === 'blocked' && isSupportedResolvableTask(task)) ??
    null
  )
}

function isSupportedResolvableTask(task: WaypointBeadsRunTask): boolean {
  return task.kind === 'wait' || task.kind === 'gate' || (task.metadata.waypoint.artifacts?.length ?? 0) > 0
}

function assertAllowsTransition(verification: WaypointBeadsTaskCompletionVerification): void {
  if (verification.action === 'allow_close') return
  throw new Error(
    `Cannot close Beads task ${verification.task.plan_ref}: ${verification.block_reasons.join(', ') || 'blocked'}`,
  )
}

function statusAfterRouteIssueResume(run: WaypointBeadsRunReconstruction): WaypointFolderRouteStatus {
  if (run.tasks.length === 0) return 'active'
  if (run.tasks.some((task) => task.status === 'failed')) return 'failed'
  if (run.tasks.every((task) => task.status === 'done')) return 'complete'
  if (run.tasks.some((task) => task.status === 'in_progress')) return 'active'

  const readyTasks = run.tasks.filter((task) => task.status === 'open' && task.blockers.length === 0)
  if (readyTasks.some((task) => task.kind !== 'gate' && task.kind !== 'wait')) return 'active'
  if (readyTasks.length > 0 || run.tasks.some((task) => task.status === 'blocked')) return 'blocked'
  return 'active'
}

function routeFromRun(
  run: WaypointBeadsRunReconstruction,
  status: WaypointFolderRouteStatus,
  currentNode: string | null,
): WaypointFolderRoute {
  return {
    id: run.route.id,
    quest: run.route.quest,
    status,
    current_node: currentNode,
    subject: run.route.subject,
    created_at: run.route.created_at ?? '',
    updated_at: new Date().toISOString(),
    metadata: {
      waypoint: run.route.metadata.waypoint,
      backend: { route: 'beads' },
      beads: {
        issue_id: run.route.beads_id,
        progress: run.route.progress,
      },
    },
  }
}

function routeDecisionComment(
  decision: 'approved' | 'rejected',
  routeId: string,
  task: WaypointBeadsRunTask,
  note: string | undefined,
): string {
  return `Waypoint gate ${decision} on route ${routeId}: ${task.plan_ref}${note ? `\n\n${note}` : ''}`
}
