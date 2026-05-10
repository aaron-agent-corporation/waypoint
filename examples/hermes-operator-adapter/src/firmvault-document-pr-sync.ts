import { join } from 'node:path'

import {
  recordFirmVaultDocumentHandoffWithHermesOperator,
  resolveFirmVaultCasesRoot,
  type FirmVaultCasesRegistry,
  type FirmVaultDocumentHandoffStatus,
} from './firmvault-case-bootstrap.ts'
import type { WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

export type FirmVaultDocumentPrState = 'open' | 'merged' | 'closed' | 'failed'

export interface FirmVaultDocumentPrLookup {
  readonly prNumber?: number
  readonly prUrl?: string
  readonly branch?: string
}

export interface FirmVaultDocumentPrStatus {
  readonly state: FirmVaultDocumentPrState
  readonly prNumber?: number
  readonly prUrl?: string
  readonly branch?: string
  readonly mergedAt?: string
  readonly closedAt?: string
  readonly error?: string
}

export type FirmVaultDocumentPrStatusClient = (
  lookup: FirmVaultDocumentPrLookup,
) => Promise<FirmVaultDocumentPrStatus>

export interface FirmVaultDocumentPrSyncRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly documentId: string
  readonly handoff: {
    readonly status: FirmVaultDocumentHandoffStatus
    readonly prNumber?: number
    readonly prUrl?: string
    readonly branch?: string
  }
}

export interface FirmVaultDocumentPrSyncOptions {
  readonly prClient: FirmVaultDocumentPrStatusClient
  readonly waypointExecutor?: WaypointCommandExecutor
}

export interface FirmVaultDocumentPrSyncResult {
  readonly ok: boolean
  readonly changed: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly documentId: string
  readonly previousStatus: FirmVaultDocumentHandoffStatus
  readonly nextStatus: FirmVaultDocumentHandoffStatus
  readonly prNumber: number | null
  readonly prUrl: string | null
  readonly branch: string | null
  readonly completedAt: string | null
  readonly legalLandmarksUpdated: false
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export async function syncFirmVaultDocumentPrStatusWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultDocumentPrSyncRequest,
  options: FirmVaultDocumentPrSyncOptions,
): Promise<FirmVaultDocumentPrSyncResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  validatePrSyncRequest(request)
  const caseRoot = join(casesRoot.path, request.caseSlug)

  const prStatus = await options.prClient({
    ...(request.handoff.prNumber !== undefined ? { prNumber: request.handoff.prNumber } : {}),
    ...(request.handoff.prUrl ? { prUrl: request.handoff.prUrl } : {}),
    ...(request.handoff.branch ? { branch: request.handoff.branch } : {}),
  })
  const next = mapPrStateToHandoff(request.handoff.status, prStatus)
  const prNumber = prStatus.prNumber ?? request.handoff.prNumber ?? null
  const prUrl = prStatus.prUrl ?? request.handoff.prUrl ?? null
  const branch = prStatus.branch ?? request.handoff.branch ?? null

  if (next.status === request.handoff.status && !next.completedAt) {
    return {
      ok: true,
      changed: false,
      casesRootKey: request.casesRootKey,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      documentId: request.documentId,
      previousStatus: request.handoff.status,
      nextStatus: request.handoff.status,
      prNumber,
      prUrl,
      branch,
      completedAt: null,
      legalLandmarksUpdated: false,
      stdout: '',
      stderr: '',
      summary: `FirmVault document ${request.documentId} PR remains ${request.handoff.status}; legal landmarks unchanged.`,
    }
  }

  const handoff = await recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
    casesRootKey: request.casesRootKey,
    caseSlug: request.caseSlug,
    documentId: request.documentId,
    status: next.status,
    ...(prNumber !== null ? { prNumber } : {}),
    ...(prUrl !== null ? { prUrl } : {}),
    ...(branch !== null ? { branch } : {}),
    ...(next.completedAt ? { completedAt: next.completedAt } : {}),
  }, { executor: options.waypointExecutor })

  return {
    ok: handoff.ok,
    changed: true,
    casesRootKey: request.casesRootKey,
    hermesProfile: casesRoot.hermesProfile,
    caseRoot,
    caseSlug: request.caseSlug,
    documentId: request.documentId,
    previousStatus: request.handoff.status,
    nextStatus: handoff.status,
    prNumber,
    prUrl,
    branch,
    completedAt: next.completedAt ?? null,
    legalLandmarksUpdated: false,
    stdout: handoff.stdout,
    stderr: handoff.stderr,
    summary: `FirmVault document ${request.documentId} PR sync recorded ${handoff.status}; legal landmarks unchanged.`,
  }
}

function mapPrStateToHandoff(
  currentStatus: FirmVaultDocumentHandoffStatus,
  prStatus: FirmVaultDocumentPrStatus,
): { readonly status: FirmVaultDocumentHandoffStatus; readonly completedAt?: string } {
  if (prStatus.state === 'open') return { status: currentStatus }
  if (prStatus.state === 'merged') {
    return {
      status: 'merged',
      ...(prStatus.mergedAt ? { completedAt: prStatus.mergedAt } : {}),
    }
  }
  if (prStatus.state === 'closed') {
    return {
      status: 'deferred',
      ...(prStatus.closedAt ? { completedAt: prStatus.closedAt } : {}),
    }
  }
  return { status: 'failed' }
}

function validatePrSyncRequest(request: FirmVaultDocumentPrSyncRequest): void {
  assertSafeCaseSlug(request.caseSlug)
  if (request.documentId.trim() === '') throw new Error('FirmVault documentId is required')
  if (!hasPrLookup(request.handoff)) {
    throw new Error('FirmVault document handoff must include prNumber, prUrl, or branch before PR sync')
  }
}

function hasPrLookup(handoff: FirmVaultDocumentPrSyncRequest['handoff']): boolean {
  return handoff.prNumber !== undefined || Boolean(handoff.prUrl) || Boolean(handoff.branch)
}

function assertSafeCaseSlug(caseSlug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(caseSlug)) throw new Error(`Invalid FirmVault case slug: ${caseSlug}`)
}
