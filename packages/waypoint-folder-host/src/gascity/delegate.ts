import { appendRouteEvent } from '../events/jsonl.ts'
import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import type { StartedQuestRouteBeadsSummary } from '../routes/start.ts'
import type { WaypointRouteBackendMode } from '../project/config.ts'
import type {
  WaypointGasCityConvoyResult,
  WaypointGasCityCreateConvoyInput,
  WaypointGasCityPreflight,
  WaypointGasCityPreflightInput,
  WaypointGasCitySlingBeadInput,
  WaypointGasCitySlingResult,
} from './cli-adapter.ts'
import {
  formatWaypointGasCityMetadataVerificationFailure,
  repairWaypointGasCityRouteMetadata,
  verifyWaypointGasCityRouteMetadata,
  type WaypointGasCityRouteMetadataRepairClient,
  type WaypointGasCityRouteMetadataRepairPolicy,
  type WaypointGasCityRouteMetadataVerification,
} from './metadata.ts'
import { resolveWaypointGasCityRoutableIssue } from './routing.ts'

export interface WaypointGasCityRouteRuntime {
  preflight(input?: WaypointGasCityPreflightInput): Promise<WaypointGasCityPreflight>
  createConvoy?(input: WaypointGasCityCreateConvoyInput): Promise<WaypointGasCityConvoyResult>
  slingBead(input: WaypointGasCitySlingBeadInput): Promise<WaypointGasCitySlingResult>
}

export interface DelegateWaypointRouteToGasCityInput {
  readonly projectRoot: string
  readonly route: WaypointGasCityDelegatableRoute
  readonly target: string
  readonly runtime: WaypointGasCityRouteRuntime
  readonly issueReader?: WaypointBeadsIssueSnapshotReader
  readonly metadataRepairClient?: WaypointGasCityRouteMetadataRepairClient
  readonly routeMetadataRepairPolicy?: WaypointGasCityRouteMetadataRepairPolicy
  readonly city?: string
  readonly rig?: string
  readonly provider?: string
  readonly preflight?: WaypointGasCityPreflight
  readonly noFormula?: boolean
  readonly nudge?: boolean
  readonly dryRun?: boolean
  readonly force?: boolean
  readonly now?: Date
}

export interface WaypointGasCityDelegatableRoute {
  readonly id: string
  readonly backend: WaypointRouteBackendMode
  readonly beads?: StartedQuestRouteBeadsSummary
}

export interface DelegateWaypointRouteToGasCityResult {
  readonly routeId: string
  readonly target: string
  readonly beadId: string
  readonly routedBeadId: string
  readonly convoy?: WaypointGasCityConvoyResult
  readonly preflight: WaypointGasCityPreflight
  readonly sling: WaypointGasCitySlingResult
  readonly metadata: WaypointGasCityRouteMetadataVerification
}

export async function delegateWaypointRouteToGasCity(
  input: DelegateWaypointRouteToGasCityInput,
): Promise<DelegateWaypointRouteToGasCityResult> {
  if (input.route.backend !== 'beads' || !input.route.beads) {
    throw new Error('Gas City runtime requires a Beads-backed route. Initialize with --backend beads and start a Beads route first.')
  }

  const preflight = input.preflight ?? await input.runtime.preflight({ provider: input.provider })
  if (!preflight.ok) {
    throw new Error(formatWaypointGasCityPreflightFailure(preflight))
  }

  const issueClient = input.issueReader ?? new WaypointBeadsCliIssueClient({ cwd: input.projectRoot })
  const beadId = input.route.beads.root_issue_id
  const noNudge = input.nudge === false
  let convoy: WaypointGasCityConvoyResult | undefined
  let routedBeadId = beadId
  const sling = noNudge
    ? await delegateWaypointGasCityMetadataOnly({
        issueClient,
        metadataRepairClient: input.metadataRepairClient,
        beadId,
        target: input.target,
        dryRun: input.dryRun === true,
      })
    : await delegateWaypointGasCityWithConvoy({
        issueClient,
        runtime: input.runtime,
        route: input.route,
        routeId: input.route.id,
        rootBeadId: beadId,
        city: input.city,
        rig: input.rig,
        target: input.target,
        noFormula: input.noFormula ?? true,
        nudge: input.nudge ?? true,
        dryRun: input.dryRun,
        force: input.force,
        onRoutedBead: (selectedBeadId) => {
          routedBeadId = selectedBeadId
        },
        onConvoy: (created) => {
          convoy = created
        },
      })
  let metadata: WaypointGasCityRouteMetadataVerification = input.dryRun === true
    ? { ok: true, beadId: routedBeadId, target: input.target, diagnostics: [] }
    : await verifyWaypointGasCityRouteMetadata({
        issueReader: issueClient,
        beadId: routedBeadId,
        target: input.target,
      })
  if (!metadata.ok && input.routeMetadataRepairPolicy === 'metadata-only' && input.dryRun !== true) {
    const repairClient = input.metadataRepairClient ?? metadataRepairClientFromIssueReader(issueClient)
    if (!repairClient) {
      throw new Error('Gas City metadata repair policy requires a Beads metadata mutation client.')
    }
    await repairWaypointGasCityRouteMetadata({
      client: repairClient,
      beadId: routedBeadId,
      target: input.target,
    })
    metadata = await verifyWaypointGasCityRouteMetadata({
      issueReader: issueClient,
      beadId: routedBeadId,
      target: input.target,
    })
  }
  if (!metadata.ok) {
    throw new Error(formatWaypointGasCityMetadataVerificationFailure(metadata))
  }

  await appendRouteEvent(input.projectRoot, input.route.id, {
    kind: 'route.runtime.delegated',
    payload: {
      runtime: 'gascity',
      target: input.target,
      bead_id: beadId,
      routed_bead_id: routedBeadId,
      ...(convoy ? { dispatch_bead_id: convoy.convoyId, convoy_id: convoy.convoyId } : {}),
      dry_run: input.dryRun === true,
      no_formula: input.noFormula ?? true,
      nudge: input.nudge ?? true,
      delegation_mode: sling.mode ?? 'gascity-sling',
      metadata: {
        routed_to: metadata.routedTo,
        molecule_id: metadata.moleculeId,
      },
    },
    now: input.now,
  })

  return {
    routeId: input.route.id,
    target: input.target,
    beadId,
    routedBeadId,
    ...(convoy ? { convoy } : {}),
    preflight,
    sling,
    metadata,
  }
}

async function delegateWaypointGasCityWithConvoy(input: {
  readonly issueClient: WaypointBeadsIssueSnapshotReader
  readonly runtime: WaypointGasCityRouteRuntime
  readonly route: WaypointGasCityDelegatableRoute
  readonly routeId: string
  readonly rootBeadId: string
  readonly city?: string
  readonly rig?: string
  readonly target: string
  readonly noFormula: boolean
  readonly nudge: boolean
  readonly dryRun?: boolean
  readonly force?: boolean
  readonly onRoutedBead: (beadId: string) => void
  readonly onConvoy: (convoy: WaypointGasCityConvoyResult) => void
}): Promise<WaypointGasCitySlingResult> {
  if (!input.runtime.createConvoy) {
    throw new Error('Gas City nudge-enabled delegation requires convoy support. Use --gascity-no-nudge for metadata-only routing or provide a runtime with createConvoy().')
  }
  const routable = await resolveWaypointGasCityRoutableIssue({
    route: input.route,
    issueReader: input.issueClient,
  })
  input.onRoutedBead(routable.routedBeadId)
  if (input.dryRun === true) {
    return {
      command: 'gascity-convoy-dry-run',
      stdout: `dry-run create convoy waypoint-${input.routeId} ${routable.routedBeadId} and sling to ${input.target}\n`,
      stderr: '',
      target: input.target,
      beadId: routable.routedBeadId,
      mode: 'gascity-sling',
    }
  }
  const convoy = await input.runtime.createConvoy({
    city: input.city,
    rig: input.rig,
    name: `waypoint-${input.routeId}`,
    issueIds: [routable.routedBeadId],
  })
  input.onConvoy(convoy)
  return input.runtime.slingBead({
    city: input.city,
    rig: input.rig,
    target: input.target,
    beadId: convoy.convoyId,
    noFormula: input.noFormula,
    nudge: input.nudge,
    dryRun: input.dryRun,
    force: input.force,
  })
}

async function delegateWaypointGasCityMetadataOnly(input: {
  readonly issueClient: WaypointBeadsIssueSnapshotReader
  readonly metadataRepairClient?: WaypointGasCityRouteMetadataRepairClient
  readonly beadId: string
  readonly target: string
  readonly dryRun: boolean
}): Promise<WaypointGasCitySlingResult> {
  if (!input.dryRun) {
    const repairClient = input.metadataRepairClient ?? metadataRepairClientFromIssueReader(input.issueClient)
    if (!repairClient) {
      throw new Error('Gas City no-nudge delegation requires a Beads metadata mutation client.')
    }
    await repairWaypointGasCityRouteMetadata({
      client: repairClient,
      beadId: input.beadId,
      target: input.target,
    })
  }
  return {
    command: 'metadata-only',
    stdout: input.dryRun ? 'metadata-only dry-run\n' : 'metadata-only route metadata updated\n',
    stderr: '',
    target: input.target,
    beadId: input.beadId,
    mode: 'metadata-only',
  }
}

function metadataRepairClientFromIssueReader(issueReader: WaypointBeadsIssueSnapshotReader): WaypointGasCityRouteMetadataRepairClient | null {
  if (typeof (issueReader as { updateIssueMetadata?: unknown }).updateIssueMetadata !== 'function') return null
  return issueReader as unknown as WaypointGasCityRouteMetadataRepairClient
}

export function formatWaypointGasCityPreflightFailure(preflight: WaypointGasCityPreflight): string {
  const failed = preflight.checks.filter((check) => !check.ok)
  if (failed.length === 0) return 'Gas City preflight failed.'
  return [
    'Gas City preflight failed.',
    ...failed.map((check) => {
      const details = check.details ? ` Details: ${check.details}` : ''
      const guidance = check.guidance ? ` ${check.guidance}` : ''
      return `${check.tool}: ${check.command} ${check.args.join(' ')} failed.${details}${guidance}`
    }),
  ].join(' ')
}
