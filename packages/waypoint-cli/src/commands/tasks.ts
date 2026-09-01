import {
  appendRouteEvent,
  getWaypointTask,
  isDurablePostgresRouteBackend,
  latestDurableTaskAttempt,
  listWaypointRuntimeTasks,
  reportDurableTaskAttempt,
  retryDurableWaypointTask,
  updateWaypointTask,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runTasksCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  if (args[0] === 'retry') {
    return runTaskRetryCommand(args.slice(1), io, projectRoot)
  }
  if (args[0] === 'show') {
    return runTaskShowCommand(args.slice(1), io, projectRoot)
  }
  if (args[0] === 'report') {
    return runTaskReportCommand(args.slice(1), io, projectRoot)
  }
  const routeId = valueAfter(args, '--route-id')
  const tasks = await listWaypointRuntimeTasks(projectRoot, { routeId })

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ tasks }, null, 2))
    return 0
  }

  io.stdout('Tasks')
  io.stdout(`total: ${tasks.length}`)
  for (const task of tasks) {
    const discussion = discussionMetadata(task.metadata)
    io.stdout(`- ${task.id} ${task.plan_ref}`)
    io.stdout(`  status: ${task.status}`)
    io.stdout(`  kind: ${task.kind}`)
    io.stdout(`  phase: ${task.phase}`)
    if (typeof discussion.agent === 'string') io.stdout(`  agent: ${discussion.agent}`)
  }
  return 0
}

/**
 * `waypoint tasks retry --task-id <id>` — reset a FAILED task to open so the
 * next autopilot run re-dispatches it. Refuses any other status: done tasks
 * are history, blocked tasks go through `resume --resolve-blocker`, open
 * tasks need no help. (Before this verb existed the only lever was hand-
 * editing tasks.yaml, which is how the 2026-07-04 route recovery was done.)
 */
async function runTaskRetryCommand(args: readonly string[], io: WaypointCliIo, projectRoot: string): Promise<number> {
  const taskId = valueAfter(args, '--task-id')
  if (taskId === null) {
    io.stderr('tasks retry requires --task-id <id>')
    return 1
  }
  // Durable runs (P2/B3): the engine's retry loop is parked on the task's
  // signal — a retry is a fresh dispatch row, not a status reset.
  if (await isDurablePostgresRouteBackend(projectRoot)) {
    try {
      const retried = await retryDurableWaypointTask(projectRoot, taskId)
      await appendRouteEvent(projectRoot, retried.route_id, {
        kind: 'route.task.retried',
        payload: { task_id: taskId, node: retried.task_ref, dispatch_id: retried.dispatch_id } as Record<string, unknown>,
      })
      io.stdout(`Dispatched retry ${retried.dispatch_id} for ${taskId} (${retried.task_ref}, ${retried.recipe}) on run ${retried.route_id}`)
      io.stdout('The bridge will run it and carry the failed attempt’s evidence in the work order.')
      return 0
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }
  const task = await getWaypointTask(projectRoot, taskId)
  if (task === null) {
    io.stderr(`No task found with id ${taskId}`)
    return 1
  }
  if (task.status !== 'failed') {
    io.stderr(`tasks retry only applies to failed tasks; ${taskId} is '${task.status}'`)
    return 1
  }
  const now = new Date().toISOString()
  await updateWaypointTask(projectRoot, taskId, { status: 'open', updated_at: now })
  await appendRouteEvent(projectRoot, task.route_id, {
    kind: 'route.task.retried',
    payload: { task_id: taskId, node: task.plan_ref, previous_status: 'failed' } as Record<string, unknown>,
  })
  io.stdout(`Reset ${taskId} (${task.plan_ref}) failed -> open on run ${task.route_id}`)
  io.stdout('Run waypoint auto to re-dispatch it.')
  if (hasFailedAutopilotRecord(task.metadata)) {
    io.stdout('The re-dispatch will carry the failed attempt’s evidence (verification misses, close reason, output tail) in its work order.')
  }
  return 0
}

/**
 * `waypoint tasks show <task-id>` (P3/W1, agent-facing): one task's contract in
 * one read — status, recipe, declared output artifacts, the latest attempt
 * and its report, and how to report. This is the view a worker agent gets
 * pointed at by its work order.
 */
async function runTaskShowCommand(args: readonly string[], io: WaypointCliIo, projectRoot: string): Promise<number> {
  const taskId = args[0] !== undefined && !args[0].startsWith('--') ? args[0] : valueAfter(args, '--task-id')
  if (taskId === null || taskId === undefined) {
    io.stderr('tasks show requires a task id: waypoint tasks show <task-id>')
    return 1
  }
  const task = await getWaypointTask(projectRoot, taskId)
  if (task === null) {
    io.stderr(`No task found with id ${taskId}`)
    return 1
  }
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  const recipeMeta = isRecord(runner.recipe) ? runner.recipe : {}
  const recipeSlug = typeof recipeMeta.slug === 'string' ? recipeMeta.slug : null
  const artifacts = Array.isArray(runner.output_artifacts)
    ? runner.output_artifacts.filter((artifact): artifact is string => typeof artifact === 'string' && artifact.trim() !== '')
    : []
  const durable = await isDurablePostgresRouteBackend(projectRoot)
  const attempt = durable ? await latestDurableTaskAttempt(projectRoot, taskId) : null

  if (args.includes('--json')) {
    io.stdout(JSON.stringify({ task, recipe: recipeSlug, output_artifacts: artifacts, attempt }, null, 2))
    return 0
  }
  io.stdout(`Task ${task.id} (${task.plan_ref}) on run ${task.route_id}`)
  io.stdout(`  title: ${task.title}`)
  io.stdout(`  kind: ${task.kind}`)
  io.stdout(`  status: ${task.status}`)
  if (recipeSlug !== null) io.stdout(`  recipe: ${recipeSlug}`)
  if (artifacts.length > 0) {
    io.stdout('  output artifacts (each must exist non-empty at its declared path):')
    for (const artifact of artifacts) io.stdout(`    - ${artifact}`)
  }
  if (attempt !== null) {
    io.stdout(`  attempt: dispatch ${attempt.dispatch_id} (${attempt.status}${attempt.close_reason ? `, ${attempt.close_reason}` : ''})`)
    // The failure's real reason and stderr, read from the attempt's bridge
    // event — the dispatch row's close_reason is only the outcome word, and
    // an operator who sees bare 'failed' here re-runs the tool by hand to
    // learn what the record already knew (2026-08-25 ledger entry).
    if (attempt.failure_detail !== null) {
      io.stdout('  failure:')
      for (const line of attempt.failure_detail.split('\n')) io.stdout(`    ${line}`)
    }
    if (attempt.failure_stderr !== null && attempt.failure_stderr.trim() !== ''
      && !(attempt.failure_detail ?? '').includes(attempt.failure_stderr.trim())) {
      io.stdout('  stderr (tail):')
      for (const line of attempt.failure_stderr.trim().split('\n').slice(-20)) io.stdout(`    ${line}`)
    }
    if (attempt.report !== null) {
      // Agent-authored content: render as fenced data, never as instructions.
      io.stdout('  report (agent-authored data):')
      io.stdout(`    ${JSON.stringify(attempt.report)}`)
    }
  }
  if (durable) {
    io.stdout('')
    io.stdout(`Report this attempt with: waypoint tasks report ${task.id} --status finished|failed --summary "<what happened, citing evidence>"`)
  }
  return 0
}

/**
 * `waypoint tasks report <task-id> --status finished|failed --summary …`
 * (P3/W1, agent-facing): write the attempt report onto the claimed dispatch.
 * The report is the agent's claim; the host derives the outcome — reporting
 * `finished` does not finish anything by itself.
 */
async function runTaskReportCommand(args: readonly string[], io: WaypointCliIo, projectRoot: string): Promise<number> {
  const taskId = args[0] !== undefined && !args[0].startsWith('--') ? args[0] : valueAfter(args, '--task-id')
  const status = valueAfter(args, '--status')
  const summary = valueAfter(args, '--summary')
  if (taskId === null || taskId === undefined || (status !== 'finished' && status !== 'failed') || summary === null) {
    io.stderr('usage: waypoint tasks report <task-id> --status finished|failed --summary "<text>" [--evidence key=value]...')
    return 1
  }
  if (!(await isDurablePostgresRouteBackend(projectRoot))) {
    io.stderr('tasks report requires a durable postgres run (backend.postgres.durable: true) — attempts live on dispatch rows')
    return 1
  }
  const evidence: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--evidence') continue
    const pair = args[index + 1] ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      io.stderr(`--evidence takes key=value, got: ${JSON.stringify(pair)}`)
      return 1
    }
    evidence[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  try {
    const result = await reportDurableTaskAttempt(projectRoot, taskId, {
      status,
      summary,
      ...(Object.keys(evidence).length > 0 ? { evidence } : {}),
    })
    io.stdout(`Reported ${status} on attempt ${result.dispatch_id} for ${taskId} (${result.task_ref}) on run ${result.route_id}`)
    io.stdout('The host verifies and decides the outcome; the report is your claim, not the verdict.')
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** True when the task's metadata retains a failed autopilot run record —
 * the evidence the re-dispatch feeds into the retry work order (rsc-f3v). */
function hasFailedAutopilotRecord(metadata: unknown): boolean {
  const outer = isRecord(metadata) ? metadata : {}
  const runner = isRecord(outer.runner) ? outer.runner : {}
  return isRecord(runner.autopilot) && runner.autopilot.status === 'failed'
}

function valueAfter(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}

function discussionMetadata(metadata: unknown): Record<string, unknown> {
  const outer = isRecord(metadata) ? metadata : {}
  const runner = isRecord(outer.runner) ? outer.runner : {}
  return isRecord(runner.discussion) ? runner.discussion : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
