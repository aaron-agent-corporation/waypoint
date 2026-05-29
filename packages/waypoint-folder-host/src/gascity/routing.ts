import type { WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import {
  reconstructWaypointRunFromBeads,
  type WaypointBeadsRunTask,
} from '../beads/reconstruct.ts'

export interface WaypointGasCityRoutableRoute {
  readonly id: string
  readonly beads?: {
    readonly root_issue_id: string
  }
}

export interface WaypointGasCityRoutableIssue {
  readonly rootBeadId: string
  readonly routedBeadId: string
  readonly task: WaypointBeadsRunTask
}

export async function resolveWaypointGasCityRoutableIssue(input: {
  readonly route: WaypointGasCityRoutableRoute
  readonly issueReader: WaypointBeadsIssueSnapshotReader
}): Promise<WaypointGasCityRoutableIssue> {
  const rootBeadId = input.route.beads?.root_issue_id
  if (!rootBeadId) {
    throw new Error(`Waypoint route ${input.route.id} does not record a Beads root issue id.`)
  }

  const snapshots = await input.issueReader.listIssueSnapshots()
  const run = reconstructWaypointRunFromBeads({
    routeId: input.route.id,
    issues: snapshots.issues,
    dependencies: snapshots.dependencies,
  })
  const task = selectWaypointGasCityRoutableTask(run.tasks, run.route.current_node)
  if (!task) {
    throw new Error(`Waypoint route ${input.route.id} has no current Gas City-routable Beads task. Human gates and wait nodes must be advanced before nudge-enabled delegation.`)
  }
  return {
    rootBeadId,
    routedBeadId: task.beads_id,
    task,
  }
}

export function selectWaypointGasCityRoutableTask(
  tasks: readonly WaypointBeadsRunTask[],
  currentNode: string | null,
): WaypointBeadsRunTask | null {
  const current = currentNode ? tasks.find((task) => task.plan_ref === currentNode) : undefined
  if (current && isWaypointGasCityBlockingControlTask(current)) return null
  if (current && isWaypointGasCityRoutableTask(current)) return current
  return tasks.find(isWaypointGasCityRoutableTask) ?? null
}

function isWaypointGasCityBlockingControlTask(task: WaypointBeadsRunTask): boolean {
  return task.status !== 'done' && (task.kind === 'gate' || task.kind === 'wait')
}

function isWaypointGasCityRoutableTask(task: WaypointBeadsRunTask): boolean {
  return task.status === 'open' && task.blockers.length === 0 && task.kind !== 'gate' && task.kind !== 'wait'
}
