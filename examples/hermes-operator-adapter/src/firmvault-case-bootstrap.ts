import { isAbsolute } from 'node:path'

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

interface FirmVaultBootstrapJson {
  readonly case_root?: unknown
  readonly case_slug?: unknown
  readonly route_id?: unknown
  readonly landmarks?: unknown
}

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

function parseBootstrapJson(stdout: string): FirmVaultBootstrapJson {
  try {
    return JSON.parse(stdout) as FirmVaultBootstrapJson
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`FirmVault bootstrap did not return valid JSON: ${message}`)
  }
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
