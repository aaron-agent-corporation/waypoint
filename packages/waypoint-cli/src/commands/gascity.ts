import {
  delegateWaypointRouteToGasCity,
  formatWaypointGasCityErrorEnvelope,
  getWaypointProjectPaths,
  getWaypointRoute,
  inspectWaypointGasCityRoute,
  readWaypointProjectConfig,
  WaypointGasCityCliAdapter,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import type {
  WaypointBeadsIssueSnapshotReader,
  WaypointGasCityDelegatableRoute,
  WaypointGasCityDiagnosticsRuntime,
  WaypointGasCityRouteMetadataRepairPolicy,
  WaypointGasCityRouteRuntime,
} from '@waypoint/folder-host'

export interface RunGasCityCommandDeps {
  readonly createRuntime?: (input: CreateGasCityRuntimeInput) => WaypointGasCityCommandRuntime
  readonly issueReader?: WaypointBeadsIssueSnapshotReader
}

export type WaypointGasCityCommandRuntime = WaypointGasCityDiagnosticsRuntime & WaypointGasCityRouteRuntime

export interface CreateGasCityRuntimeInput {
  readonly cwd: string
  readonly city?: string
  readonly rig?: string
}

export async function runGasCityCommand(args: readonly string[], io: WaypointCliIo, deps: RunGasCityCommandDeps = {}): Promise<number> {
  const [subcommand] = args
  const json = hasFlag(args, '--json')
  try {
    if (subcommand === 'preflight') {
      return await runGasCityPreflight(args.slice(1), io, deps, json)
    }
    if (subcommand === 'diagnose') {
      return await runGasCityDiagnose(args.slice(1), io, deps, json)
    }
    if (subcommand === 'sling') {
      return await runGasCitySling(args.slice(1), io, deps, json)
    }
    io.stderr('Unknown Waypoint Gas City command. Expected preflight, diagnose, or sling.')
    return 1
  } catch (error) {
    const envelope = formatWaypointGasCityErrorEnvelope(error)
    if (json) {
      io.stdout(JSON.stringify(envelope, null, 2))
    } else {
      io.stderr(envelope.details ? `${envelope.error} ${envelope.details}` : envelope.error)
    }
    return 1
  }
}

async function runGasCitySling(
  args: readonly string[],
  io: WaypointCliIo,
  deps: RunGasCityCommandDeps,
  json: boolean,
): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const routeId = readOption(args, '--route-id')
  if (!routeId) throw new Error('waypoint gascity sling requires --route-id <id>.')

  const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
  const target = readOption(args, '--target') ?? readOption(args, '--gascity-target') ?? config.runtime.gascity?.target
  if (!target) {
    throw new Error('Gas City sling requires --target <rig/agent> or runtime.gascity.target in .waypoint/config.yaml.')
  }

  const route = await readDelegatableRoute(projectRoot, routeId)
  const runtime = createRuntime(projectRoot, args, deps, config.runtime.gascity)
  const provider = readOption(args, '--provider') ?? readOption(args, '--gascity-provider') ?? config.runtime.gascity?.provider ?? 'codex'
  const dryRun = hasFlag(args, '--dry-run') || hasFlag(args, '--gascity-dry-run')
  const noFormula = config.runtime.gascity?.sling?.no_formula ?? true
  const nudge = hasFlag(args, '--no-nudge') || hasFlag(args, '--gascity-no-nudge') ? false : config.runtime.gascity?.sling?.nudge ?? true
  const routeMetadataRepairPolicy = routeMetadataRepairPolicyFromArgs(args, config.runtime.gascity?.repair_policy?.route_metadata)
  const city = readOption(args, '--city') ?? readOption(args, '--gascity-city') ?? config.runtime.gascity?.city
  const rig = readOption(args, '--rig') ?? readOption(args, '--gascity-rig') ?? config.runtime.gascity?.rig
  const delegated = await delegateWaypointRouteToGasCity({
    projectRoot,
    route,
    target,
    provider,
    runtime,
    ...(deps.issueReader ? { issueReader: deps.issueReader } : {}),
    ...(city ? { city } : {}),
    ...(rig ? { rig } : {}),
    noFormula,
    nudge,
    dryRun,
    routeMetadataRepairPolicy,
  })
  const ok = delegated.preflight.ok && delegated.metadata.ok

  if (json) {
    io.stdout(JSON.stringify({ ok, action: 'gascity.sling', ...delegated }, null, 2))
  } else {
    io.stdout(`Gas City sling: ${dryRun ? 'dry-run' : 'delegated'}`)
    io.stdout(`route: ${delegated.routeId}`)
    io.stdout(`target: ${delegated.target}`)
    io.stdout(`bead: ${delegated.beadId}`)
    if (delegated.routedBeadId !== delegated.beadId) io.stdout(`routed bead: ${delegated.routedBeadId}`)
    if (delegated.convoy) io.stdout(`dispatch bead: ${delegated.convoy.convoyId}`)
    io.stdout(`metadata: ${delegated.metadata.ok ? 'verified' : 'failed'}`)
  }
  return ok ? 0 : 1
}

async function runGasCityPreflight(
  args: readonly string[],
  io: WaypointCliIo,
  deps: RunGasCityCommandDeps,
  json: boolean,
): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const runtime = createRuntime(projectRoot, args, deps, null)
  const provider = readOption(args, '--provider') ?? readOption(args, '--gascity-provider') ?? 'codex'
  const preflight = await runtime.preflight({ provider })
  if (json) {
    io.stdout(JSON.stringify({ ok: preflight.ok, action: 'gascity.preflight', preflight }, null, 2))
  } else {
    printPreflight(io, preflight)
  }
  return preflight.ok ? 0 : 1
}

async function runGasCityDiagnose(
  args: readonly string[],
  io: WaypointCliIo,
  deps: RunGasCityCommandDeps,
  json: boolean,
): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const routeId = readOption(args, '--route-id')
  if (!routeId) throw new Error('waypoint gascity diagnose requires --route-id <id>.')

  const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
  const target = readOption(args, '--target') ?? readOption(args, '--gascity-target') ?? config.runtime.gascity?.target
  if (!target) {
    throw new Error('Gas City diagnostics require --target <rig/agent> or runtime.gascity.target in .waypoint/config.yaml.')
  }

  const runtime = createRuntime(projectRoot, args, deps, config.runtime.gascity)
  const provider = readOption(args, '--provider') ?? readOption(args, '--gascity-provider') ?? config.runtime.gascity?.provider ?? 'codex'
  const result = await inspectWaypointGasCityRoute({
    projectRoot,
    routeId,
    target,
    provider,
    runtime,
    ...(deps.issueReader ? { issueReader: deps.issueReader } : {}),
  })
  const ok = result.preflight.ok && !result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')

  if (json) {
    io.stdout(JSON.stringify({ ok, action: 'gascity.diagnose', ...result }, null, 2))
  } else {
    printDiagnostics(io, result, ok)
  }
  return ok ? 0 : 1
}

function createRuntime(
  projectRoot: string,
  args: readonly string[],
  deps: RunGasCityCommandDeps,
  config: { readonly city?: string; readonly rig?: string } | null | undefined,
): WaypointGasCityCommandRuntime {
  const city = readOption(args, '--city') ?? readOption(args, '--gascity-city') ?? config?.city
  const rig = readOption(args, '--rig') ?? readOption(args, '--gascity-rig') ?? config?.rig
  return deps.createRuntime
    ? deps.createRuntime({ cwd: projectRoot, ...(city ? { city } : {}), ...(rig ? { rig } : {}) })
    : new WaypointGasCityCliAdapter({ cwd: projectRoot, ...(city ? { city } : {}), ...(rig ? { rig } : {}) })
}

async function readDelegatableRoute(projectRoot: string, routeId: string): Promise<WaypointGasCityDelegatableRoute> {
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Waypoint route not found: ${routeId}`)
  return {
    id: route.id,
    backend: routeBackendFromMetadata(route.metadata),
    ...(beadsFromMetadata(route.metadata) ? { beads: beadsFromMetadata(route.metadata)! } : {}),
  }
}

function routeBackendFromMetadata(metadata: Record<string, unknown> | undefined): 'folder' | 'beads' {
  const backend = isRecord(metadata?.backend) ? metadata.backend : {}
  return backend.route === 'beads' ? 'beads' : 'folder'
}

function beadsFromMetadata(metadata: Record<string, unknown> | undefined): { root_issue_id: string; issue_count: number; dependency_count: number } | null {
  const beads = isRecord(metadata?.beads) ? metadata.beads : {}
  const rootIssueId = typeof beads.root_issue_id === 'string' ? beads.root_issue_id : null
  if (!rootIssueId) return null
  return {
    root_issue_id: rootIssueId,
    issue_count: typeof beads.issue_count === 'number' ? beads.issue_count : 0,
    dependency_count: typeof beads.dependency_count === 'number' ? beads.dependency_count : 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function printPreflight(io: WaypointCliIo, preflight: Awaited<ReturnType<WaypointGasCityDiagnosticsRuntime['preflight']>>): void {
  io.stdout(`Gas City preflight: ${preflight.ok ? 'passed' : 'failed'}`)
  for (const check of preflight.checks) {
    const detail = check.version ?? check.details ?? ''
    io.stdout(`- ${check.ok ? 'ok' : 'fail'} ${check.tool}${detail ? `: ${detail}` : ''}`)
    if (!check.ok && check.guidance) io.stdout(`  guidance: ${check.guidance}`)
  }
}

function printDiagnostics(
  io: WaypointCliIo,
  result: Awaited<ReturnType<typeof inspectWaypointGasCityRoute>>,
  ok: boolean,
): void {
  io.stdout(`Gas City diagnostics: ${ok ? 'passed' : 'blocked'}`)
  io.stdout(`route: ${result.routeId}`)
  io.stdout(`target: ${result.target}`)
  io.stdout(`bead: ${result.beadId}`)
  if (result.routedBeadId !== result.beadId) io.stdout(`routed bead: ${result.routedBeadId}`)
  printPreflight(io, result.preflight)
  if (result.diagnostics.length === 0) {
    io.stdout('diagnostics: none')
    return
  }
  io.stdout('diagnostics:')
  for (const diagnostic of result.diagnostics) {
    io.stdout(`- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.evidence}`)
    for (const guidance of diagnostic.guidance) io.stdout(`  guidance: ${guidance}`)
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name)
}

function routeMetadataRepairPolicyFromArgs(
  args: readonly string[],
  configured: string | undefined,
): WaypointGasCityRouteMetadataRepairPolicy {
  if (hasFlag(args, '--repair-metadata') || hasFlag(args, '--gascity-repair-metadata')) return 'metadata-only'
  return configured === 'metadata-only' ? 'metadata-only' : 'report-only'
}
