import type { WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import type { WaypointBeadsIssueSnapshot } from '../beads/reconstruct.ts'
import { diagnoseWaypointGasCityState, type WaypointGasCityDiagnostic } from './cli-adapter.ts'

export interface VerifyWaypointGasCityRouteMetadataInput {
  readonly issueReader: WaypointBeadsIssueSnapshotReader
  readonly beadId: string
  readonly target: string
  readonly expectedMoleculeId?: string
}

export interface WaypointGasCityRouteMetadataVerification {
  readonly ok: boolean
  readonly beadId: string
  readonly target: string
  readonly routedTo?: string
  readonly moleculeId?: string
  readonly diagnostics: readonly WaypointGasCityDiagnostic[]
}

export type WaypointGasCityRouteMetadataRepairPolicy = 'report-only' | 'metadata-only'

export interface WaypointGasCityRouteMetadataRepairClient {
  updateIssueMetadata(input: { readonly id: string; readonly metadata: Readonly<Record<string, string>> }): Promise<void>
}

export interface RepairWaypointGasCityRouteMetadataInput {
  readonly client: WaypointGasCityRouteMetadataRepairClient
  readonly beadId: string
  readonly target: string
  readonly moleculeId?: string
}

export async function verifyWaypointGasCityRouteMetadata(
  input: VerifyWaypointGasCityRouteMetadataInput,
): Promise<WaypointGasCityRouteMetadataVerification> {
  const snapshots = await input.issueReader.listIssueSnapshots()
  const issue = snapshots.issues.find((entry) => entry.id === input.beadId)
  if (!issue) {
    throw new Error(`Cannot verify Gas City route metadata because Beads issue was not found: ${input.beadId}`)
  }

  const metadata = metadataRecord(issue)
  const diagnostics = diagnoseWaypointGasCityState({
    expectedTarget: input.target,
    expectedMoleculeId: input.expectedMoleculeId,
    task: {
      id: issue.id,
      status: issue.status,
      assignee: issue.assignee,
      ...(metadata ? { metadata } : {}),
    },
  })
  const routedTo = typeof metadata?.['gc.routed_to'] === 'string' ? metadata['gc.routed_to'] : undefined
  const moleculeId = typeof metadata?.molecule_id === 'string' ? metadata.molecule_id : undefined

  return {
    ok: diagnostics.length === 0,
    beadId: input.beadId,
    target: input.target,
    ...(routedTo ? { routedTo } : {}),
    ...(moleculeId ? { moleculeId } : {}),
    diagnostics,
  }
}

export function formatWaypointGasCityMetadataVerificationFailure(
  verification: WaypointGasCityRouteMetadataVerification,
): string {
  if (verification.ok) return 'Gas City route metadata verified.'
  return [
    `Gas City route metadata verification failed for Bead ${verification.beadId}.`,
    ...verification.diagnostics.flatMap((diagnostic) => [
      `${diagnostic.code}: ${diagnostic.evidence}`,
      ...diagnostic.guidance,
    ]),
  ].join(' ')
}

export async function repairWaypointGasCityRouteMetadata(input: RepairWaypointGasCityRouteMetadataInput): Promise<void> {
  await input.client.updateIssueMetadata({
    id: input.beadId,
    metadata: {
      'gc.routed_to': input.target,
      ...(input.moleculeId ? { molecule_id: input.moleculeId } : {}),
    },
  })
}

function metadataRecord(issue: WaypointBeadsIssueSnapshot): Record<string, unknown> | undefined {
  return isRecord(issue.metadata) ? issue.metadata : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
