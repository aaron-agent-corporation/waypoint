import { basename } from 'node:path'

import {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  initWaypointProject,
  initializeWaypointBeadsWorkspace,
  installQuestCatalog,
  loadBundledWaypointCatalog,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import type { WaypointRouteBackendMode } from '@waypoint/folder-host'

export async function runInitCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readStringOption(args, '--quest') ?? 'waypoint'
  const backend = parseBackendOption(readStringOption(args, '--backend'))
  const initBeads = args.includes('--init-beads')
  if (!backend) {
    io.stderr('Invalid --backend value. Expected folder or beads.')
    return 1
  }
  if (initBeads && backend !== 'beads') {
    io.stderr('--init-beads can only be used with --backend beads.')
    return 1
  }
  const projectRoot = io.cwd ?? process.cwd()
  if (initBeads) {
    const readiness = await initializeWaypointBeadsWorkspace({ cwd: projectRoot, prefix: basename(projectRoot) })
    if (!readiness.ok) {
      io.stderr(formatWaypointBeadsWorkspaceReadinessFailure(readiness))
      return 1
    }
  }
  const catalog = await loadBundledWaypointCatalog()
  const result = await initWaypointProject(projectRoot, { quest, backend })
  const installed = await installQuestCatalog(projectRoot, catalog, { quest })
  const routeBackend = result.config.backend?.route ?? 'folder'
  const beadsReadiness = routeBackend === 'beads'
    ? await checkWaypointBeadsWorkspace({ cwd: projectRoot })
    : null

  io.stdout(`Initialized Waypoint project at ${result.projectRoot}`)
  io.stdout(`quest: ${result.config.quest}`)
  io.stdout(`route backend: ${routeBackend}`)
  if (beadsReadiness) {
    io.stdout(`beads workspace: ${beadsReadiness.status}`)
    if (beadsReadiness.path) io.stdout(`beads path: ${beadsReadiness.path}`)
    if (!beadsReadiness.ok) io.stdout(`beads action: ${beadsReadiness.hint}`)
  }
  io.stdout(`config: ${result.waypointDir}/config.yaml`)
  io.stdout(`installed Quest manifests: ${installed.installedQuestPaths.length}`)
  io.stdout(`installed Recipe manifests: ${installed.installedRecipePaths.length}`)
  return 0
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function parseBackendOption(value: string | null): WaypointRouteBackendMode | null {
  if (value === null || value === 'folder') return 'folder'
  if (value === 'beads') return 'beads'
  return null
}
