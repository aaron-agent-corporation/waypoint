import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export const FIRMVAULT_LANDMARK_SLUGS = [
  'case_setup_complete',
  'full_intake_complete',
  'accident_report_obtained',
  'providers_setup',
  'demand_sent',
  'initial_offer_received',
  'settlement_reached',
  'final_distribution_complete',
] as const

export const FIRMVAULT_CASE_STATE_FILES = [
  'case.yaml',
  'client.yaml',
  'accident.yaml',
  'providers.yaml',
  'demand.yaml',
  'negotiation.yaml',
  'settlement.yaml',
  'documents.yaml',
  'landmarks.yaml',
  'events.jsonl',
] as const

export type FirmVaultLandmarkSlug = typeof FIRMVAULT_LANDMARK_SLUGS[number]
export type FirmVaultCaseType = 'personal_injury'

export interface FirmVaultEvidenceRef {
  readonly path: string
  readonly kind?: string
  readonly note?: string
}

export interface FirmVaultLandmarkState {
  readonly satisfied: boolean
  readonly evidence: readonly FirmVaultEvidenceRef[]
}

export type FirmVaultLandmarkMap = Record<FirmVaultLandmarkSlug, FirmVaultLandmarkState>

export interface FirmVaultLandmarkProjection {
  readonly schema_version: 1
  readonly generated_at: string
  readonly landmarks: FirmVaultLandmarkMap
  readonly warnings: readonly string[]
}

export interface InitFirmVaultCaseStateOptions {
  readonly caseType: FirmVaultCaseType
  readonly caseSlug?: string
  readonly now?: Date
}

export interface InitFirmVaultCaseStateResult {
  readonly stateDir: string
  readonly projection: FirmVaultLandmarkProjection
}

interface FactInput {
  readonly status?: unknown
  readonly acceptedStatuses: readonly string[]
  readonly evidence?: unknown
}

export async function initFirmVaultCaseState(
  projectRoot: string,
  options: InitFirmVaultCaseStateOptions,
): Promise<InitFirmVaultCaseStateResult> {
  const stateDir = firmVaultStateDir(projectRoot)
  const now = timestampFor(options.now)
  await mkdir(stateDir, { recursive: true })

  await Promise.all([
    writeYaml(join(stateDir, 'case.yaml'), initialCaseState(options, now)),
    writeYaml(join(stateDir, 'client.yaml'), initialClientState()),
    writeYaml(join(stateDir, 'accident.yaml'), initialAccidentState()),
    writeYaml(join(stateDir, 'providers.yaml'), initialProvidersState()),
    writeYaml(join(stateDir, 'demand.yaml'), initialDemandState()),
    writeYaml(join(stateDir, 'negotiation.yaml'), initialNegotiationState()),
    writeYaml(join(stateDir, 'settlement.yaml'), initialSettlementState()),
    writeYaml(join(stateDir, 'documents.yaml'), initialDocumentsState()),
  ])

  const projection = await readFirmVaultLandmarkProjection(projectRoot, { now: options.now })
  await writeYaml(join(stateDir, 'landmarks.yaml'), projection)
  await appendFirmVaultEvent(projectRoot, {
    type: 'firmvault.case_state.initialized',
    created_at: now,
    payload: {
      case_type: options.caseType,
      case_slug: options.caseSlug ?? null,
      landmarks: FIRMVAULT_LANDMARK_SLUGS.length,
    },
  })

  return { stateDir, projection }
}

export async function readFirmVaultLandmarkProjection(
  projectRoot: string,
  options: { readonly now?: Date } = {},
): Promise<FirmVaultLandmarkProjection> {
  const stateDir = firmVaultStateDir(projectRoot)
  const warnings: string[] = []
  const [caseState, clientState, accidentState, providersState, demandState, negotiationState, settlementState] = await Promise.all([
    readYamlRecord(join(stateDir, 'case.yaml')),
    readYamlRecord(join(stateDir, 'client.yaml')),
    readYamlRecord(join(stateDir, 'accident.yaml')),
    readYamlRecord(join(stateDir, 'providers.yaml')),
    readYamlRecord(join(stateDir, 'demand.yaml')),
    readYamlRecord(join(stateDir, 'negotiation.yaml')),
    readYamlRecord(join(stateDir, 'settlement.yaml')),
  ])

  const landmarks: FirmVaultLandmarkMap = {
    case_setup_complete: await factLandmark(projectRoot, 'case_setup_complete', warnings, {
      status: getPath(caseState, ['case', 'setup', 'status']),
      acceptedStatuses: ['complete'],
      evidence: getPath(caseState, ['case', 'setup', 'evidence']),
    }),
    full_intake_complete: await aggregateLandmark(projectRoot, 'full_intake_complete', warnings, [
      {
        status: getPath(clientState, ['client', 'intake', 'status']),
        acceptedStatuses: ['complete'],
        evidence: getPath(clientState, ['client', 'intake', 'evidence']),
      },
      {
        status: getPath(clientState, ['client', 'contracts', 'fee_agreement', 'status']),
        acceptedStatuses: ['signed'],
        evidence: getPath(clientState, ['client', 'contracts', 'fee_agreement', 'evidence']),
      },
      {
        status: getPath(clientState, ['client', 'authorizations', 'hipaa', 'status']),
        acceptedStatuses: ['signed'],
        evidence: getPath(clientState, ['client', 'authorizations', 'hipaa', 'evidence']),
      },
    ]),
    accident_report_obtained: await factLandmark(projectRoot, 'accident_report_obtained', warnings, {
      status: getPath(accidentState, ['accident', 'police_report', 'status']),
      acceptedStatuses: ['received'],
      evidence: getPath(accidentState, ['accident', 'police_report', 'evidence']),
    }),
    providers_setup: await factLandmark(projectRoot, 'providers_setup', warnings, {
      status: getPath(providersState, ['providers_setup', 'status']),
      acceptedStatuses: ['complete'],
      evidence: getPath(providersState, ['providers_setup', 'evidence']),
    }),
    demand_sent: await factLandmark(projectRoot, 'demand_sent', warnings, {
      status: getPath(demandState, ['demand', 'status']),
      acceptedStatuses: ['sent', 'delivered'],
      evidence: getPath(demandState, ['demand', 'evidence']),
    }),
    initial_offer_received: await factLandmark(projectRoot, 'initial_offer_received', warnings, {
      status: getPath(negotiationState, ['negotiation', 'initial_offer', 'status']),
      acceptedStatuses: ['received'],
      evidence: getPath(negotiationState, ['negotiation', 'initial_offer', 'evidence']),
    }),
    settlement_reached: await factLandmark(projectRoot, 'settlement_reached', warnings, {
      status: getPath(settlementState, ['settlement', 'status']),
      acceptedStatuses: ['reached', 'signed', 'funded', 'distributed'],
      evidence: getPath(settlementState, ['settlement', 'evidence']),
    }),
    final_distribution_complete: await factLandmark(projectRoot, 'final_distribution_complete', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'status']),
      acceptedStatuses: ['complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'evidence']),
    }),
  }

  return {
    schema_version: 1,
    generated_at: timestampFor(options.now),
    landmarks,
    warnings,
  }
}

async function factLandmark(
  projectRoot: string,
  slug: FirmVaultLandmarkSlug,
  warnings: string[],
  input: FactInput,
): Promise<FirmVaultLandmarkState> {
  if (typeof input.status !== 'string' || !input.acceptedStatuses.includes(input.status)) {
    return { satisfied: false, evidence: [] }
  }
  const evidence = await validEvidence(projectRoot, slug, input.evidence, warnings)
  return evidence.length > 0 ? { satisfied: true, evidence } : { satisfied: false, evidence: [] }
}

async function aggregateLandmark(
  projectRoot: string,
  slug: FirmVaultLandmarkSlug,
  warnings: string[],
  facts: readonly FactInput[],
): Promise<FirmVaultLandmarkState> {
  const evidence: FirmVaultEvidenceRef[] = []
  for (const fact of facts) {
    const landmark = await factLandmark(projectRoot, slug, warnings, fact)
    if (!landmark.satisfied) return { satisfied: false, evidence: [] }
    evidence.push(...landmark.evidence)
  }
  return { satisfied: true, evidence }
}

async function validEvidence(
  projectRoot: string,
  slug: FirmVaultLandmarkSlug,
  value: unknown,
  warnings: string[],
): Promise<FirmVaultEvidenceRef[]> {
  if (!Array.isArray(value) || value.length === 0) {
    warnings.push(`${slug} requires at least one evidence path.`)
    return []
  }

  const valid: FirmVaultEvidenceRef[] = []
  for (const item of value) {
    const path = evidencePathFor(item)
    if (!path) {
      warnings.push(`${slug} evidence entry is missing a path.`)
      continue
    }
    if (!isSafeRelativePath(path)) {
      warnings.push(`${slug} evidence path must be relative and inside the case folder: ${path}`)
      continue
    }
    if (!(await pathExists(join(projectRoot, path)))) {
      warnings.push(`${slug} evidence path does not exist: ${path}`)
      continue
    }
    const kind = evidenceKindFor(item)
    valid.push({ path, ...(kind ? { kind } : {}) })
  }
  return valid
}

function initialCaseState(options: InitFirmVaultCaseStateOptions, now: string): Record<string, unknown> {
  return {
    schema_version: 1,
    case: {
      type: options.caseType,
      slug: options.caseSlug ?? null,
      matter_status: 'intake',
      opened_at: null,
      created_at: now,
      setup: {
        status: 'not_started',
        evidence: [],
      },
    },
  }
}

function initialClientState(): Record<string, unknown> {
  return {
    schema_version: 1,
    client: {
      intake: { status: 'missing', evidence: [] },
      contracts: { fee_agreement: { status: 'missing', evidence: [] } },
      authorizations: { hipaa: { status: 'missing', evidence: [] } },
    },
  }
}

function initialAccidentState(): Record<string, unknown> {
  return { schema_version: 1, accident: { police_report: { status: 'missing', evidence: [] } } }
}

function initialProvidersState(): Record<string, unknown> {
  return { schema_version: 1, providers_setup: { status: 'not_started', evidence: [] }, providers: [] }
}

function initialDemandState(): Record<string, unknown> {
  return { schema_version: 1, demand: { status: 'not_ready', blockers: [], evidence: [] } }
}

function initialNegotiationState(): Record<string, unknown> {
  return { schema_version: 1, negotiation: { initial_offer: { status: 'none', amount: null, evidence: [] } } }
}

function initialSettlementState(): Record<string, unknown> {
  return {
    schema_version: 1,
    settlement: {
      status: 'none',
      evidence: [],
      distribution: { status: 'not_started', evidence: [] },
    },
  }
}

function initialDocumentsState(): Record<string, unknown> {
  return { schema_version: 1, documents: [] }
}

async function appendFirmVaultEvent(projectRoot: string, event: Record<string, unknown>): Promise<void> {
  await appendFile(join(firmVaultStateDir(projectRoot), 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8')
}

async function writeYaml(path: string, value: unknown): Promise<void> {
  await writeFile(path, yamlStringify(value), 'utf8')
}

async function readYamlRecord(path: string): Promise<Record<string, unknown>> {
  const parsed = yamlParse(await readFile(path, 'utf8'))
  return isRecord(parsed) ? parsed : {}
}

function firmVaultStateDir(projectRoot: string): string {
  return join(projectRoot, '.waypoint', 'firmvault')
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function evidencePathFor(item: unknown): string | null {
  if (typeof item === 'string') return item
  if (isRecord(item) && typeof item.path === 'string') return item.path
  return null
}

function evidenceKindFor(item: unknown): string | null {
  if (isRecord(item) && typeof item.kind === 'string') return item.kind
  return null
}

function isSafeRelativePath(path: string): boolean {
  if (isAbsolute(path)) return false
  const normalized = normalize(path)
  return normalized.length > 0 && normalized !== '.' && !normalized.startsWith('..')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
