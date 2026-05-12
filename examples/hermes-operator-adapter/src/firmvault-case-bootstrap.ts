import { isAbsolute, join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import { runSafeWaypointCommand, type WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

export type FirmVaultCaseType = 'personal_injury'

export interface FirmVaultCasesRootRecord {
  readonly key: string
  readonly path: string
  readonly waypointCli: string
  readonly hermesProfile: 'paralegal'
}

export interface FirmVaultCasesRegistry {
  readonly casesRoots: Readonly<Record<string, FirmVaultCasesRootRecord>>
}

export interface FirmVaultNewCaseRequest {
  readonly casesRootKey: string
  readonly caseName: string
  readonly caseType: FirmVaultCaseType
  readonly start?: boolean
}

export interface FirmVaultHermesOperatorOptions {
  readonly executor?: WaypointCommandExecutor
}

export interface FirmVaultHermesBootstrapResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly routeId: string | null
  readonly landmarkCount: number
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export type FirmVaultDocumentKind = 'medical_records' | 'bill' | 'insurance' | 'police_report' | 'correspondence' | 'unknown'
export type FirmVaultDocumentHandoffStatus = 'not_started' | 'submitted' | 'pr_opened' | 'merged' | 'deferred' | 'failed'

export interface FirmVaultDocumentAddRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly source: string
  readonly kind: FirmVaultDocumentKind
  readonly note?: string
}

export interface FirmVaultDocumentHandoffRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly documentId: string
  readonly status: FirmVaultDocumentHandoffStatus
  readonly prNumber?: number
  readonly prUrl?: string
  readonly branch?: string
  readonly submittedAt?: string
  readonly completedAt?: string
}

export interface FirmVaultHermesDocumentAddResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly documentId: string
  readonly path: string
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export interface FirmVaultHermesDocumentHandoffResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly documentId: string
  readonly status: FirmVaultDocumentHandoffStatus
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export interface FirmVaultStateShowRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly section?: string
}

export interface FirmVaultEvidenceCheckRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly path: string
}

export interface FirmVaultStateSetRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly fact: string
  readonly status: string
  readonly evidence?: readonly string[]
  readonly note?: string
}

export interface FirmVaultHermesStateShowResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly section: string | null
  readonly landmarkCount: number
  readonly state: Record<string, unknown>
  readonly warnings: readonly string[]
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export interface FirmVaultHermesEvidenceCheckResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly path: string
  readonly exists: boolean
  readonly safe: boolean
  readonly reason: string | null
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

export interface FirmVaultHermesStateSetResult {
  readonly ok: boolean
  readonly casesRootKey: string
  readonly hermesProfile: 'paralegal'
  readonly caseRoot: string
  readonly caseSlug: string
  readonly fact: string
  readonly status: string
  readonly evidence: readonly string[]
  readonly newlySatisfied: readonly string[]
  readonly newlyUnsatisfied: readonly string[]
  readonly legalLandmarksUpdated: boolean
  readonly stdout: string
  readonly stderr: string
  readonly summary: string
}

interface FirmVaultBootstrapJson {
  readonly case_root?: unknown
  readonly case_slug?: unknown
  readonly route_id?: unknown
  readonly landmarks?: unknown
}

interface FirmVaultDocumentAddJson {
  readonly document_id?: unknown
  readonly path?: unknown
}

interface FirmVaultDocumentHandoffJson {
  readonly document_id?: unknown
  readonly handoff?: unknown
}

interface FirmVaultStateShowJson {
  readonly section?: unknown
  readonly state?: unknown
  readonly landmarks?: unknown
  readonly warnings?: unknown
}

interface FirmVaultEvidenceCheckJson {
  readonly ok?: unknown
  readonly path?: unknown
  readonly exists?: unknown
  readonly safe?: unknown
  readonly reason?: unknown
}

interface FirmVaultStateSetJson {
  readonly ok?: unknown
  readonly fact?: unknown
  readonly status?: unknown
  readonly evidence?: unknown
  readonly newly_satisfied?: unknown
  readonly newly_unsatisfied?: unknown
  readonly legal_landmarks_updated?: unknown
}

const FIRMVAULT_DOCUMENT_KINDS = new Set<FirmVaultDocumentKind>(['medical_records', 'bill', 'insurance', 'police_report', 'correspondence', 'unknown'])
const FIRMVAULT_HANDOFF_STATUSES = new Set<FirmVaultDocumentHandoffStatus>(['not_started', 'submitted', 'pr_opened', 'merged', 'deferred', 'failed'])

export function parseFirmVaultCasesRegistry(source: string): FirmVaultCasesRegistry {
  const parsed = yamlParse(source) as unknown
  const root = asRecord(parsed, 'FirmVault cases registry must be a YAML object')
  const casesRoots = asRecord(root.cases_roots, 'FirmVault cases registry must define cases_roots')
  const records: Record<string, FirmVaultCasesRootRecord> = {}

  for (const [key, rawCasesRoot] of Object.entries(casesRoots)) {
    assertSafeCasesRootKey(key)
    const casesRoot = asRecord(rawCasesRoot, `FirmVault cases root ${key} must be a YAML object`)
    const path = stringField(casesRoot, 'path', `FirmVault cases root ${key} path is required`)
    if (!isAbsolute(path)) throw new Error(`FirmVault cases root ${key} path must be absolute`)

    const waypointCli = stringField(casesRoot, 'waypoint_cli', `FirmVault cases root ${key} waypoint_cli is required`)
    if (!isAbsolute(waypointCli)) throw new Error(`FirmVault cases root ${key} waypoint_cli must be absolute`)

    const hermesProfile = stringField(casesRoot, 'hermes_profile', `FirmVault cases root ${key} hermes_profile is required`)
    if (hermesProfile !== 'paralegal') throw new Error(`FirmVault cases root ${key} must use Hermes profile paralegal`)

    records[key] = { key, path, waypointCli, hermesProfile: 'paralegal' }
  }

  return { casesRoots: records }
}

export function resolveFirmVaultCasesRoot(
  registry: FirmVaultCasesRegistry,
  casesRootKey: string,
): FirmVaultCasesRootRecord {
  const casesRoot = registry.casesRoots[casesRootKey]
  if (!casesRoot) throw new Error(`Unknown FirmVault cases root key: ${casesRootKey}`)
  return casesRoot
}

export function createFirmVaultCaseWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultNewCaseRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesBootstrapResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  if (request.caseType !== 'personal_injury') throw new Error(`Unsupported FirmVault case type: ${request.caseType}`)
  if (request.caseName.trim() === '') throw new Error('FirmVault caseName is required')

  const args = [
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot.path,
    '--case-name',
    request.caseName,
    '--case-type',
    'personal-injury',
    ...(request.start ? ['--start'] : []),
    '--json',
  ]

  return runSafeWaypointCommand({ name: casesRoot.key, path: casesRoot.path, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseBootstrapJson(commandResult.stdout)
    const caseSlug = stringJsonField(parsed.case_slug, 'case_slug')
    const caseRoot = stringJsonField(parsed.case_root, 'case_root')
    const routeId = typeof parsed.route_id === 'string' ? parsed.route_id : null
    const landmarkCount = readLandmarkCount(parsed.landmarks)

    return {
      ok: commandResult.ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug,
      routeId,
      landmarkCount,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault case ${caseSlug} bootstrapped under ${casesRoot.key} with Hermes profile ${casesRoot.hermesProfile}.`,
    }
  })
}

export async function addFirmVaultDocumentWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultDocumentAddRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesDocumentAddResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  const caseRoot = resolveCaseRoot(casesRoot, request.caseSlug)
  validateDocumentAddRequest(request)

  const args = [
    'firmvault',
    'add-document',
    '--source',
    request.source,
    '--kind',
    cliDocumentKind(request.kind),
    ...(request.note ? ['--note', request.note] : []),
    '--json',
  ]

  return await runSafeWaypointCommand({ name: casesRoot.key, path: caseRoot, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseDocumentAddJson(commandResult.stdout)
    const documentId = stringJsonField(parsed.document_id, 'document_id')
    const path = stringJsonField(parsed.path, 'path')
    return {
      ok: commandResult.ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      documentId,
      path,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault document ${documentId} added to ${request.caseSlug} through Hermes profile ${casesRoot.hermesProfile}.`,
    }
  })
}

export async function recordFirmVaultDocumentHandoffWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultDocumentHandoffRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesDocumentHandoffResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  const caseRoot = resolveCaseRoot(casesRoot, request.caseSlug)
  validateDocumentHandoffRequest(request)

  const args = [
    'firmvault',
    'document-handoff',
    '--document-id',
    request.documentId,
    '--status',
    cliHandoffStatus(request.status),
    ...(request.prNumber !== undefined ? ['--pr-number', String(request.prNumber)] : []),
    ...(request.prUrl ? ['--pr-url', request.prUrl] : []),
    ...(request.branch ? ['--branch', request.branch] : []),
    ...(request.submittedAt ? ['--submitted-at', request.submittedAt] : []),
    ...(request.completedAt ? ['--completed-at', request.completedAt] : []),
    '--json',
  ]

  return await runSafeWaypointCommand({ name: casesRoot.key, path: caseRoot, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseDocumentHandoffJson(commandResult.stdout)
    const documentId = stringJsonField(parsed.document_id, 'document_id')
    const handoff = asRecord(parsed.handoff, 'FirmVault document handoff JSON missing handoff')
    const status = stringJsonField(handoff.status, 'handoff.status') as FirmVaultDocumentHandoffStatus
    return {
      ok: commandResult.ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      documentId,
      status,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault document ${documentId} handoff recorded as ${status} for ${request.caseSlug}.`,
    }
  })
}

export async function showFirmVaultStateWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultStateShowRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesStateShowResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  const caseRoot = resolveCaseRoot(casesRoot, request.caseSlug)
  const args = ['firmvault', 'state', 'show', ...(request.section ? ['--section', request.section] : []), '--json']

  return await runSafeWaypointCommand({ name: casesRoot.key, path: caseRoot, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseStateShowJson(commandResult.stdout)
    const section = parsed.section === null ? null : typeof parsed.section === 'string' ? parsed.section : null
    const landmarks = asRecord(parsed.landmarks, 'FirmVault state show JSON missing landmarks')
    const landmarkCount = numberJsonField(landmarks.total, 'landmarks.total')
    const state = asRecord(parsed.state, 'FirmVault state show JSON missing state')
    const warnings = stringArrayJsonField(parsed.warnings, 'warnings')
    return {
      ok: commandResult.ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      section,
      landmarkCount,
      state,
      warnings,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault state ${section ?? 'all'} read for ${request.caseSlug} through Hermes profile ${casesRoot.hermesProfile}.`,
    }
  })
}

export async function checkFirmVaultEvidenceWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultEvidenceCheckRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesEvidenceCheckResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  const caseRoot = resolveCaseRoot(casesRoot, request.caseSlug)
  assertSafeEvidencePath(request.path)
  const args = ['firmvault', 'evidence', 'check', '--path', request.path, '--json']

  return await runSafeWaypointCommand({ name: casesRoot.key, path: caseRoot, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseEvidenceCheckJson(commandResult.stdout)
    const path = stringJsonField(parsed.path, 'path')
    const exists = booleanJsonField(parsed.exists, 'exists')
    const safe = booleanJsonField(parsed.safe, 'safe')
    const ok = booleanJsonField(parsed.ok, 'ok')
    const reason = parsed.reason === null || typeof parsed.reason === 'string' ? parsed.reason : null
    return {
      ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      path,
      exists,
      safe,
      reason,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault evidence ${path} is ${safe ? 'safe' : 'unsafe'} and ${exists ? 'exists' : 'missing'} for ${request.caseSlug}.`,
    }
  })
}

export async function setFirmVaultStateFactWithHermesOperator(
  registry: FirmVaultCasesRegistry,
  request: FirmVaultStateSetRequest,
  options: FirmVaultHermesOperatorOptions = {},
): Promise<FirmVaultHermesStateSetResult> {
  const casesRoot = resolveFirmVaultCasesRoot(registry, request.casesRootKey)
  const caseRoot = resolveCaseRoot(casesRoot, request.caseSlug)
  validateStateSetRequest(request)
  const evidenceArgs = (request.evidence ?? []).flatMap((path) => ['--evidence', path])
  const args = [
    'firmvault',
    'state',
    'set',
    '--fact',
    request.fact,
    '--status',
    request.status,
    ...evidenceArgs,
    ...(request.note ? ['--note', request.note] : []),
    '--json',
  ]

  return await runSafeWaypointCommand({ name: casesRoot.key, path: caseRoot, waypointCli: casesRoot.waypointCli }, args, {
    executor: options.executor,
  }).then((commandResult) => {
    const parsed = parseStateSetJson(commandResult.stdout)
    const fact = stringJsonField(parsed.fact, 'fact')
    const status = stringJsonField(parsed.status, 'status')
    const evidence = stringArrayJsonField(parsed.evidence, 'evidence')
    const newlySatisfied = stringArrayJsonField(parsed.newly_satisfied, 'newly_satisfied')
    const newlyUnsatisfied = stringArrayJsonField(parsed.newly_unsatisfied, 'newly_unsatisfied')
    const legalLandmarksUpdated = booleanJsonField(parsed.legal_landmarks_updated, 'legal_landmarks_updated')
    return {
      ok: commandResult.ok,
      casesRootKey: casesRoot.key,
      hermesProfile: casesRoot.hermesProfile,
      caseRoot,
      caseSlug: request.caseSlug,
      fact,
      status,
      evidence,
      newlySatisfied,
      newlyUnsatisfied,
      legalLandmarksUpdated,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      summary: `FirmVault fact ${fact} set to ${status} for ${request.caseSlug}; newly satisfied: ${newlySatisfied.length > 0 ? newlySatisfied.join(', ') : 'none'}.`,
    }
  })
}

function parseBootstrapJson(stdout: string): FirmVaultBootstrapJson {
  try {
    return JSON.parse(stdout) as FirmVaultBootstrapJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault bootstrap did not return valid JSON: ${message}`)
  }
}

function parseDocumentAddJson(stdout: string): FirmVaultDocumentAddJson {
  try {
    return JSON.parse(stdout) as FirmVaultDocumentAddJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault add-document did not return valid JSON: ${message}`)
  }
}

function parseDocumentHandoffJson(stdout: string): FirmVaultDocumentHandoffJson {
  try {
    return JSON.parse(stdout) as FirmVaultDocumentHandoffJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault document-handoff did not return valid JSON: ${message}`)
  }
}

function parseStateShowJson(stdout: string): FirmVaultStateShowJson {
  try {
    return JSON.parse(stdout) as FirmVaultStateShowJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault state show did not return valid JSON: ${message}`)
  }
}

function parseEvidenceCheckJson(stdout: string): FirmVaultEvidenceCheckJson {
  try {
    return JSON.parse(stdout) as FirmVaultEvidenceCheckJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault evidence check did not return valid JSON: ${message}`)
  }
}

function parseStateSetJson(stdout: string): FirmVaultStateSetJson {
  try {
    return JSON.parse(stdout) as FirmVaultStateSetJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault state set did not return valid JSON: ${message}`)
  }
}

function resolveCaseRoot(casesRoot: FirmVaultCasesRootRecord, caseSlug: string): string {
  assertSafeCaseSlug(caseSlug)
  return join(casesRoot.path, caseSlug)
}

function validateDocumentAddRequest(request: FirmVaultDocumentAddRequest): void {
  assertSafeCaseSlug(request.caseSlug)
  if (!isAbsolute(request.source)) throw new Error('FirmVault document source must be an absolute path')
  if (!FIRMVAULT_DOCUMENT_KINDS.has(request.kind)) throw new Error(`Unsupported FirmVault document kind: ${request.kind}`)
}

function validateDocumentHandoffRequest(request: FirmVaultDocumentHandoffRequest): void {
  assertSafeCaseSlug(request.caseSlug)
  if (request.documentId.trim() === '') throw new Error('FirmVault documentId is required')
  if (!FIRMVAULT_HANDOFF_STATUSES.has(request.status)) throw new Error(`Unsupported FirmVault document handoff status: ${request.status}`)
}

function validateStateSetRequest(request: FirmVaultStateSetRequest): void {
  assertSafeCaseSlug(request.caseSlug)
  if (request.fact.trim() === '') throw new Error('FirmVault fact is required')
  if (request.status.trim() === '') throw new Error('FirmVault status is required')
  for (const evidencePath of request.evidence ?? []) assertSafeEvidencePath(evidencePath)
}

function assertSafeEvidencePath(path: string): void {
  if (isAbsolute(path) || path.trim() === '' || path.split(/[/\\]+/).includes('..')) {
    throw new Error(`FirmVault evidence path must be a safe relative path: ${path}`)
  }
}

function cliDocumentKind(kind: FirmVaultDocumentKind): string {
  if (kind === 'medical_records') return 'medical-records'
  if (kind === 'police_report') return 'police-report'
  return kind
}

function cliHandoffStatus(status: FirmVaultDocumentHandoffStatus): string {
  if (status === 'not_started') return 'not-started'
  if (status === 'pr_opened') return 'pr-opened'
  return status
}

function assertSafeCaseSlug(caseSlug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(caseSlug)) throw new Error(`Invalid FirmVault case slug: ${caseSlug}`)
}

function readLandmarkCount(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0
  const total = (value as Record<string, unknown>).total
  return typeof total === 'number' ? total : 0
}

function stringJsonField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`FirmVault bootstrap JSON missing ${field}`)
  return value
}

function numberJsonField(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`FirmVault JSON missing numeric ${field}`)
  return value
}

function booleanJsonField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`FirmVault JSON missing boolean ${field}`)
  return value
}

function stringArrayJsonField(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`FirmVault JSON missing string array ${field}`)
  return value.filter((item): item is string => typeof item === 'string')
}

function assertSafeCasesRootKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) throw new Error(`Invalid FirmVault cases root key: ${key}`)
}

function stringField(record: Record<string, unknown>, field: string, error: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(error)
  return value
}

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}
