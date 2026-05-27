import { readWaypointStatus, type WaypointProjectStatus } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runStatusCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const status = await readWaypointStatus(io.cwd ?? process.cwd())
  if (args.includes('--json')) {
    io.stdout(JSON.stringify(statusJson(status), null, 2))
    return 0
  }

  io.stdout('Waypoint project status')
  io.stdout(`project_root: ${status.projectRoot}`)
  io.stdout(`initialized: ${status.initialized}`)
  io.stdout(`enabled: ${status.enabled}`)
  io.stdout(`quest: ${status.quest ?? 'null'}`)
  io.stdout(`route backend: ${status.backend ?? 'null'}`)
  io.stdout(`routes: ${status.routes.total}`)
  io.stdout(`active routes: ${status.routes.active}`)
  io.stdout(`blocked routes: ${status.routes.blocked}`)
  io.stdout(`blocked gates: ${status.routes.blockedGates}`)
  if (status.beads) {
    io.stdout(`beads workspace: ${status.beads.readiness.status}`)
    if (status.beads.readiness.path) io.stdout(`beads path: ${status.beads.readiness.path}`)
    if (status.beads.rootIssueIds.length > 0) io.stdout(`beads root issues: ${status.beads.rootIssueIds.join(', ')}`)
    if (!status.beads.readiness.ok) io.stdout(`beads action: ${status.beads.readiness.hint}`)
  }
  io.stdout(`config: ${status.configPath}`)
  return 0
}

function statusJson(status: WaypointProjectStatus): Record<string, unknown> {
  return {
    project_root: status.projectRoot,
    waypoint_dir: status.waypointDir,
    config_path: status.configPath,
    initialized: status.initialized,
    enabled: status.enabled,
    quest: status.quest,
    backend: status.backend,
    routes: status.routes,
    beads: status.beads
      ? {
        readiness: {
          ok: status.beads.readiness.ok,
          status: status.beads.readiness.status,
          message: status.beads.readiness.message,
          hint: status.beads.readiness.hint,
          path: status.beads.readiness.path ?? null,
          database_path: status.beads.readiness.databasePath ?? null,
          prefix: status.beads.readiness.prefix ?? null,
          details: status.beads.readiness.details ?? null,
        },
        root_issue_ids: status.beads.rootIssueIds,
      }
      : null,
  }
}
