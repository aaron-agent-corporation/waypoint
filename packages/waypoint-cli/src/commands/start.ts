import {
  delegateWaypointRouteToGasCity,
  formatWaypointGasCityErrorEnvelope,
  formatWaypointGasCityPreflightFailure,
  getWaypointProjectPaths,
  readWaypointProjectConfig,
  startQuestRoute,
  WaypointGasCityCliAdapter,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import type { WaypointGasCityPreflight, WaypointGasCityRouteMetadataRepairPolicy } from '@waypoint/folder-host'

export async function runStartCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const quest = readOption(args, '--quest') ?? 'waypoint'
  const gasCityRequested = isGasCityRequested(args)

  try {
    const projectRoot = io.cwd ?? process.cwd()
    const gasCity = gasCityRequested ? await resolveGasCityStart(projectRoot, args) : null
    const route = await startQuestRoute(projectRoot, { quest })
    io.stdout(`Started Waypoint route ${route.id}`)
    io.stdout(`quest: ${route.quest}`)
    io.stdout(`route backend: ${route.backend}`)
    io.stdout(`status: ${route.status}`)
    io.stdout(`current node: ${route.current_node ?? 'none'}`)
    if (route.beads) {
      io.stdout(`beads root issue: ${route.beads.root_issue_id}`)
      io.stdout(`beads graph: ${route.beads.issue_count} issues, ${route.beads.dependency_count} dependencies`)
    }
    io.stdout(
      `scaffolded lifecycle: ${route.scaffold.workstreams} ${plural('workstream', route.scaffold.workstreams)}, ${route.scaffold.milestones} ${plural('milestone', route.scaffold.milestones)}, ${route.scaffold.phases} ${plural('phase', route.scaffold.phases)}, ${route.scaffold.plans} ${plural('plan', route.scaffold.plans)}`,
    )
    if (gasCity) {
      const delegated = await delegateWaypointRouteToGasCity({
        projectRoot,
        route,
        target: gasCity.target,
        city: gasCity.city,
        rig: gasCity.rig,
        provider: gasCity.provider,
        runtime: gasCity.runtime,
        preflight: gasCity.preflight,
        noFormula: gasCity.noFormula,
        nudge: gasCity.nudge,
        dryRun: gasCity.dryRun,
        routeMetadataRepairPolicy: gasCity.routeMetadataRepairPolicy,
      })
      io.stdout(`gascity target: ${delegated.target}`)
      io.stdout(`gascity bead: ${delegated.beadId}`)
      if (delegated.routedBeadId !== delegated.beadId) io.stdout(`gascity routed bead: ${delegated.routedBeadId}`)
      if (delegated.convoy) io.stdout(`gascity dispatch bead: ${delegated.convoy.convoyId}`)
      io.stdout(`gascity delegated: ${gasCity.dryRun ? 'dry-run' : 'yes'}`)
    }
    return 0
  } catch (error) {
    const envelope = formatWaypointGasCityErrorEnvelope(error)
    io.stderr(envelope.details ? `${envelope.error} ${envelope.details}` : envelope.error)
    return 1
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}

interface GasCityStartRuntime {
  readonly target: string
  readonly city?: string
  readonly rig?: string
  readonly provider?: string
  readonly runtime: WaypointGasCityCliAdapter
  readonly preflight: WaypointGasCityPreflight
  readonly noFormula: boolean
  readonly nudge: boolean
  readonly dryRun: boolean
  readonly routeMetadataRepairPolicy: WaypointGasCityRouteMetadataRepairPolicy
}

async function resolveGasCityStart(projectRoot: string, args: readonly string[]): Promise<GasCityStartRuntime> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  if (config.backend.route !== 'beads') {
    throw new Error('Gas City runtime requires route backend beads. Run waypoint init --quest <slug> --backend beads --init-beads first.')
  }

  const configured = config.runtime.gascity
  const target = readOption(args, '--gascity-target') ?? configured?.target
  if (!target) {
    throw new Error('Gas City runtime requires --gascity-target <rig/agent> or runtime.gascity.target in .waypoint/config.yaml.')
  }

  const city = readOption(args, '--gascity-city') ?? configured?.city
  const rig = readOption(args, '--gascity-rig') ?? configured?.rig
  const provider = readOption(args, '--gascity-provider') ?? configured?.provider ?? 'codex'
  const noFormula = configured?.sling?.no_formula ?? true
  const nudge = hasFlag(args, '--gascity-no-nudge') ? false : configured?.sling?.nudge ?? true
  const dryRun = hasFlag(args, '--gascity-dry-run')
  const routeMetadataRepairPolicy = routeMetadataRepairPolicyFromArgs(args, configured?.repair_policy?.route_metadata)
  const runtime = new WaypointGasCityCliAdapter({ city, rig, cwd: projectRoot })
  const preflight = await runtime.preflight({ provider })
  if (!preflight.ok) {
    throw new Error(formatWaypointGasCityPreflightFailure(preflight))
  }

  return {
    target,
    ...(city ? { city } : {}),
    ...(rig ? { rig } : {}),
    provider,
    runtime,
    preflight,
    noFormula,
    nudge,
    dryRun,
    routeMetadataRepairPolicy,
  }
}

function isGasCityRequested(args: readonly string[]): boolean {
  return [
    '--gascity',
    '--gascity-target',
    '--gascity-city',
    '--gascity-rig',
    '--gascity-provider',
    '--gascity-dry-run',
    '--gascity-no-nudge',
    '--gascity-repair-metadata',
  ].some((flag) => args.includes(flag))
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name)
}

function routeMetadataRepairPolicyFromArgs(
  args: readonly string[],
  configured: string | undefined,
): WaypointGasCityRouteMetadataRepairPolicy {
  if (hasFlag(args, '--gascity-repair-metadata')) return 'metadata-only'
  return configured === 'metadata-only' ? 'metadata-only' : 'report-only'
}
