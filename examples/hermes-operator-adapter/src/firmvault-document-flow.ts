import { extname, isAbsolute } from 'node:path'

import {
  addFirmVaultDocumentWithHermesOperator,
  recordFirmVaultDocumentHandoffWithHermesOperator,
  resolveFirmVaultCasesRoot,
  type FirmVaultCasesRegistry,
  type FirmVaultDocumentHandoffStatus,
  type FirmVaultDocumentKind,
} from './firmvault-case-bootstrap.ts'
import {
  runFirmVaultDocumentPipelineWithHermesOperator,
  type FirmVaultDocumentPipelineRequest,
  type FirmVaultDocumentPipelineResult,
} from './firmvault-document-pipeline.ts'
import type { WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

export type FirmVaultDocumentFlowPipelineRunner = (
  request: FirmVaultDocumentPipelineRequest,
) => Promise<FirmVaultDocumentPipelineResult>

export interface FirmVaultScannedDocumentFlowRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly sourcePdf: string
  readonly kind: FirmVaultDocumentKind
  readonly pipelineRepoPath: string
  readonly note?: string
  readonly dryRun?: boolean
}

export interface FirmVaultScannedDocumentFlowOptions {
  readonly waypointExecutor?: WaypointCommandExecutor
  readonly pipelineRunner?: FirmVaultDocumentFlowPipelineRunner
}

export interface FirmVaultScannedDocumentFlowResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly documentId: string
  readonly documentPath: string
  readonly handoffStatus: FirmVaultDocumentHandoffStatus
  readonly prNumber: number | null
  readonly prUrl: string | null
  readonly branch: string | null
  readonly segmentsCommitted: number
  readonly segmentsParked: number
  readonly pipelineStdout: string
  readonly pipelineStderr: string
  readonly legalLandmarksUpdated: false
  readonly summary: string
}

export async function processFirmVaultScannedDocumentWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultScannedDocumentFlowRequest,
  options: FirmVaultScannedDocumentFlowOptions = {},
): Promise<FirmVaultScannedDocumentFlowResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  validateFlowRequest(request)

  const added = await addFirmVaultDocumentWithHermesOperator(registry, {
    casesRootKey: request.casesRootKey,
    caseSlug: request.caseSlug,
    source: request.sourcePdf,
    kind: request.kind,
    ...(request.note ? { note: request.note } : {}),
  }, { executor: options.waypointExecutor })

  const pipelineRunner = options.pipelineRunner ?? runFirmVaultDocumentPipelineWithHermesOperator
  const pipeline = await pipelineRunner({
    pipelineRepoPath: request.pipelineRepoPath,
    sourcePdf: request.sourcePdf,
    workflow: 'forgejo',
    ...(request.dryRun ? { dryRun: true } : {}),
  })

  const handoff = await recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
    casesRootKey: request.casesRootKey,
    caseSlug: request.caseSlug,
    documentId: added.documentId,
    status: pipeline.status,
    ...(pipeline.prNumber !== null ? { prNumber: pipeline.prNumber } : {}),
    ...(pipeline.prUrl !== null ? { prUrl: pipeline.prUrl } : {}),
    ...(pipeline.branch !== null ? { branch: pipeline.branch } : {}),
  }, { executor: options.waypointExecutor })

  const ok = added.ok && pipeline.ok && handoff.ok
  return {
    ok,
    casesRootKey: request.casesRootKey,
    hermesProfile: casesRoot.hermesProfile,
    caseRoot: added.caseRoot,
    caseSlug: request.caseSlug,
    documentId: added.documentId,
    documentPath: added.path,
    handoffStatus: handoff.status,
    prNumber: pipeline.prNumber,
    prUrl: pipeline.prUrl,
    branch: pipeline.branch,
    segmentsCommitted: pipeline.segmentsCommitted,
    segmentsParked: pipeline.segmentsParked,
    pipelineStdout: pipeline.stdout,
    pipelineStderr: pipeline.stderr,
    legalLandmarksUpdated: false,
    summary: `FirmVault document ${added.documentId} added, pipeline status ${handoff.status} recorded, legal landmarks unchanged.`,
  }
}

function validateFlowRequest(request: FirmVaultScannedDocumentFlowRequest): void {
  assertSafeCaseSlug(request.caseSlug)
  if (!isAbsolute(request.sourcePdf)) throw new Error('FirmVault document source must be an absolute path')
  if (extname(request.sourcePdf).toLowerCase() !== '.pdf') throw new Error('FirmVault document pipeline source must be a PDF')
  if (!isAbsolute(request.pipelineRepoPath)) throw new Error('FirmVault document pipeline repo path must be absolute')
}

function assertSafeCaseSlug(caseSlug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(caseSlug)) throw new Error(`Invalid FirmVault case slug: ${caseSlug}`)
}
