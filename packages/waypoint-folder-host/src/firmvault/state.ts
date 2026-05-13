import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { FIRMVAULT_FACT_DEFINITIONS, getFirmVaultFactDefinition, type FirmVaultFactDefinition, type FirmVaultStateSection } from './facts.ts'

export const FIRMVAULT_LANDMARK_SLUGS = [
  'case_setup_complete',
  'full_intake_complete',
  'accident_report_obtained',
  'providers_setup',
  'at_fault_insurance_identified',
  'bi_lor_prepared',
  'bi_lor_sent',
  'bi_acknowledgment_checked',
  'pip_track_active',
  'pip_carrier_identified',
  'pip_application_prepared',
  'pip_lor_prepared',
  'pip_application_filed',
  'pip_lor_sent',
  'pip_acknowledgment_checked',
  'pip_approved',
  'pip_status_checked',
  'pip_benefits_exhausted',
  'provider_list_reviewed',
  'provider_status_updated',
  'provider_followups_flagged',
  'treatment_status_reviewed',
  'treatment_complete',
  'health_coverage_categorized',
  'lien_clues_reviewed',
  'liens_identified',
  'lien_inventory_reviewed',
  'medical_auth_verified',
  'records_request_packet_prepared',
  'records_requested_all_providers',
  'first_records_follow_up_complete',
  'second_records_follow_up_complete',
  'third_records_follow_up_complete',
  'records_request_escalated',
  'records_and_bills_processed',
  'all_records_received',
  'medical_chronology_updated',
  'medical_records_request_workflow_complete',
  'demand_materials_gathered',
  'damages_calculated',
  'demand_readiness_reviewed',
  'demand_lien_process_checked',
  'demand_drafted',
  'attorney_reviewed_demand',
  'demand_recipients_identified',
  'demand_sent',
  'initial_offer_received',
  'offer_documented',
  'offer_evaluated',
  'net_to_client_prepared',
  'client_advised_of_offer',
  'offer_decision_documented',
  'negotiation_response_prepared',
  'negotiation_response_human_sent',
  'negotiation_result_documented',
  'settlement_reached',
  'settlement_statement_prepared',
  'authorization_to_settle_prepared',
  'client_authorized',
  'release_executed',
  'funds_received',
  'settlement_liens_audited',
  'liens_prioritized',
  'lien_available_funds_calculated',
  'settlement_lien_strategy_reviewed',
  'liens_negotiated',
  'final_distribution_statement_prepared',
  'client_distribution_issued',
  'client_distributed',
  'trust_account_zeroed',
  'liens_opened',
  'final_amount_request_prepared',
  'final_amounts_requested',
  'final_amounts_received',
  'lien_payment_authorized',
  'liens_paid',
  'final_distribution_complete',
  'all_obligations_verified',
  'final_letter_prepared',
  'final_letter_sent',
  'case_archived',
  'case_closed',
] as const

export const FIRMVAULT_CASE_STATE_FILES = [
  'case.yaml',
  'client.yaml',
  'accident.yaml',
  'providers.yaml',
  'insurance.yaml',
  'liens.yaml',
  'records.yaml',
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

export interface FirmVaultEvidencePathCheck {
  readonly ok: boolean
  readonly path: string
  readonly exists: boolean
  readonly safe: boolean
  readonly reason: 'missing' | 'unsafe' | null
}

export interface SetFirmVaultCaseFactInput {
  readonly fact: string
  readonly status: string
  readonly evidence: readonly FirmVaultEvidenceRef[]
  readonly note?: string
  readonly now?: Date
}

export interface FirmVaultLandmarkCounts {
  readonly satisfied: number
  readonly total: number
}

export interface SetFirmVaultCaseFactResult {
  readonly fact: string
  readonly file: FirmVaultStateSection
  readonly status: string
  readonly evidence: readonly FirmVaultEvidenceRef[]
  readonly landmarksBefore: FirmVaultLandmarkCounts
  readonly landmarksAfter: FirmVaultLandmarkCounts
  readonly newlySatisfied: readonly FirmVaultLandmarkSlug[]
  readonly newlyUnsatisfied: readonly FirmVaultLandmarkSlug[]
  readonly projection: FirmVaultLandmarkProjection
}

export type FirmVaultCaseStateSectionName =
  | 'case'
  | 'client'
  | 'accident'
  | 'providers'
  | 'insurance'
  | 'liens'
  | 'records'
  | 'demand'
  | 'negotiation'
  | 'settlement'
  | 'documents'

const FIRMVAULT_CASE_STATE_SECTION_NAMES = [
  'case',
  'client',
  'accident',
  'providers',
  'insurance',
  'liens',
  'records',
  'demand',
  'negotiation',
  'settlement',
  'documents',
] as const satisfies readonly FirmVaultCaseStateSectionName[]

export interface ReadFirmVaultCaseStateOptions {
  readonly section?: FirmVaultCaseStateSectionName
  readonly now?: Date
}

export interface ReadFirmVaultCaseStateResult {
  readonly schema_version: 1
  readonly section: FirmVaultCaseStateSectionName | null
  readonly state: Record<string, unknown>
  readonly landmarks: FirmVaultLandmarkCounts
  readonly warnings: readonly string[]
}

export interface FirmVaultCaseGuidanceAction {
  readonly fact: string
  readonly description: string
  readonly allowed_statuses: readonly string[]
  readonly projected_landmarks: readonly FirmVaultLandmarkSlug[]
  readonly command_hint: string
}

export interface FirmVaultCaseGuidanceResult {
  readonly schema_version: 1
  readonly mutates_state: false
  readonly stage: string
  readonly landmarks: FirmVaultLandmarkCounts
  readonly next_actions: {
    readonly required: readonly FirmVaultCaseGuidanceAction[]
    readonly blocked_by_evidence: readonly FirmVaultCaseGuidanceAction[]
  }
  readonly warnings: readonly string[]
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
    writeYaml(join(stateDir, 'insurance.yaml'), initialInsuranceState()),
    writeYaml(join(stateDir, 'liens.yaml'), initialLiensState()),
    writeYaml(join(stateDir, 'records.yaml'), initialRecordsState()),
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

export async function checkFirmVaultEvidencePath(
  projectRoot: string,
  path: string,
): Promise<FirmVaultEvidencePathCheck> {
  if (!isSafeRelativePath(path)) {
    return { ok: false, path, exists: false, safe: false, reason: 'unsafe' }
  }
  const exists = await pathExists(join(projectRoot, path))
  return {
    ok: exists,
    path,
    exists,
    safe: true,
    reason: exists ? null : 'missing',
  }
}

export async function readFirmVaultCaseState(
  projectRoot: string,
  options: ReadFirmVaultCaseStateOptions = {},
): Promise<ReadFirmVaultCaseStateResult> {
  const projection = await readFirmVaultLandmarkProjection(projectRoot, { now: options.now })
  const stateDir = firmVaultStateDir(projectRoot)
  if (options.section) {
    const file = stateSectionFile(options.section)
    return {
      schema_version: 1,
      section: options.section,
      state: await readYamlRecord(join(stateDir, file)),
      landmarks: countLandmarks(projection),
      warnings: projection.warnings,
    }
  }

  const state: Record<string, unknown> = {}
  for (const section of FIRMVAULT_CASE_STATE_SECTION_NAMES) {
    state[section] = await readYamlRecord(join(stateDir, stateSectionFile(section)))
  }

  return {
    schema_version: 1,
    section: null,
    state,
    landmarks: countLandmarks(projection),
    warnings: projection.warnings,
  }
}

export async function getFirmVaultCaseGuidance(projectRoot: string): Promise<FirmVaultCaseGuidanceResult> {
  const projection = await readFirmVaultLandmarkProjection(projectRoot)
  const landmarks = countLandmarks(projection)
  const required = FIRMVAULT_FACT_DEFINITIONS
    .filter((definition) => definition.projectedLandmarks.some((slug) => !projection.landmarks[slug]?.satisfied))
    .map(firmVaultGuidanceAction)

  return {
    schema_version: 1,
    mutates_state: false,
    stage: classifyFirmVaultGuidanceStage(projection),
    landmarks,
    next_actions: {
      required,
      blocked_by_evidence: [],
    },
    warnings: projection.warnings,
  }
}

export async function setFirmVaultCaseFact(
  projectRoot: string,
  input: SetFirmVaultCaseFactInput,
): Promise<SetFirmVaultCaseFactResult> {
  const definition = getFirmVaultFactDefinition(input.fact)
  if (!definition) throw new Error(`Unknown FirmVault fact: ${input.fact}`)
  if (!definition.allowedStatuses.includes(input.status)) {
    throw new Error(`Unsupported status for FirmVault fact ${input.fact}: ${input.status}`)
  }

  const normalizedEvidence = normalizeEvidenceRefs(input.evidence)
  if (definition.evidenceRequiredFor.includes(input.status) && normalizedEvidence.length === 0) {
    throw new Error(`FirmVault evidence is required for ${input.fact} status ${input.status}`)
  }
  for (const evidence of normalizedEvidence) {
    const check = await checkFirmVaultEvidencePath(projectRoot, evidence.path)
    if (!check.safe) throw new Error(`Unsafe FirmVault evidence path for ${input.fact}: ${evidence.path}`)
    if (!check.exists) throw new Error(`Missing FirmVault evidence path for ${input.fact}: ${evidence.path}`)
  }

  const before = await readFirmVaultLandmarkProjection(projectRoot, { now: input.now })
  const statePath = join(firmVaultStateDir(projectRoot), definition.file)
  const state = await readYamlRecord(statePath)
  setPath(state, definition.path, {
    status: input.status,
    evidence: normalizedEvidence,
    ...(input.note ? { note: input.note } : {}),
    updated_at: timestampFor(input.now),
  })
  await writeYaml(statePath, state)

  const projection = await readFirmVaultLandmarkProjection(projectRoot, { now: input.now })
  await writeYaml(join(firmVaultStateDir(projectRoot), 'landmarks.yaml'), projection)
  const newlySatisfied = diffSatisfiedLandmarks(before, projection, true)
  const newlyUnsatisfied = diffSatisfiedLandmarks(before, projection, false)
  await appendFirmVaultEvent(projectRoot, {
    type: 'firmvault.state.updated',
    created_at: timestampFor(input.now),
    payload: {
      fact: input.fact,
      file: definition.file,
      status: input.status,
      evidence: normalizedEvidence,
      ...(input.note ? { note: input.note } : {}),
      newly_satisfied: newlySatisfied,
      newly_unsatisfied: newlyUnsatisfied,
    },
  })

  return {
    fact: input.fact,
    file: definition.file,
    status: input.status,
    evidence: normalizedEvidence,
    landmarksBefore: countLandmarks(before),
    landmarksAfter: countLandmarks(projection),
    newlySatisfied,
    newlyUnsatisfied,
    projection,
  }
}

export async function readFirmVaultLandmarkProjection(
  projectRoot: string,
  options: { readonly now?: Date } = {},
): Promise<FirmVaultLandmarkProjection> {
  const stateDir = firmVaultStateDir(projectRoot)
  const warnings: string[] = []
  const [caseState, clientState, accidentState, providersState, insuranceState, liensState, recordsState, demandState, negotiationState, settlementState] = await Promise.all([
    readYamlRecord(join(stateDir, 'case.yaml')),
    readYamlRecord(join(stateDir, 'client.yaml')),
    readYamlRecord(join(stateDir, 'accident.yaml')),
    readYamlRecord(join(stateDir, 'providers.yaml')),
    readYamlRecord(join(stateDir, 'insurance.yaml')),
    readYamlRecord(join(stateDir, 'liens.yaml')),
    readYamlRecord(join(stateDir, 'records.yaml')),
    readYamlRecord(join(stateDir, 'demand.yaml')),
    readYamlRecord(join(stateDir, 'negotiation.yaml')),
    readYamlRecord(join(stateDir, 'settlement.yaml')),
  ])

  const demandSentStatus = acceptedStatusOrFallback(
    getPath(demandState, ['demand', 'send', 'status']),
    ['sent', 'delivered'],
    getPath(demandState, ['demand', 'status']),
  )
  const demandSentEvidence = demandSentStatus === getPath(demandState, ['demand', 'send', 'status'])
    ? getPath(demandState, ['demand', 'send', 'evidence'])
    : getPath(demandState, ['demand', 'evidence'])

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
    at_fault_insurance_identified: await factLandmark(projectRoot, 'at_fault_insurance_identified', warnings, {
      status: getPath(insuranceState, ['insurance', 'bi', 'carrier_identified', 'status']),
      acceptedStatuses: ['identified', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'bi', 'carrier_identified', 'evidence']),
    }),
    bi_lor_prepared: await factLandmark(projectRoot, 'bi_lor_prepared', warnings, {
      status: getPath(insuranceState, ['insurance', 'bi', 'lor', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'bi', 'lor', 'prepared', 'evidence']),
    }),
    bi_lor_sent: await factLandmark(projectRoot, 'bi_lor_sent', warnings, {
      status: getPath(insuranceState, ['insurance', 'bi', 'lor', 'sent', 'status']),
      acceptedStatuses: ['sent', 'confirmed'],
      evidence: getPath(insuranceState, ['insurance', 'bi', 'lor', 'sent', 'evidence']),
    }),
    bi_acknowledgment_checked: await factLandmark(projectRoot, 'bi_acknowledgment_checked', warnings, {
      status: getPath(insuranceState, ['insurance', 'bi', 'acknowledgment', 'status']),
      acceptedStatuses: ['checked', 'acknowledged', 'follow_up_needed'],
      evidence: getPath(insuranceState, ['insurance', 'bi', 'acknowledgment', 'evidence']),
    }),
    pip_track_active: await factLandmark(projectRoot, 'pip_track_active', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'track', 'status']),
      acceptedStatuses: ['active', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'track', 'evidence']),
    }),
    pip_carrier_identified: await factLandmark(projectRoot, 'pip_carrier_identified', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'carrier_identified', 'status']),
      acceptedStatuses: ['identified', 'assigned', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'carrier_identified', 'evidence']),
    }),
    pip_application_prepared: await factLandmark(projectRoot, 'pip_application_prepared', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'application', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'application', 'prepared', 'evidence']),
    }),
    pip_lor_prepared: await factLandmark(projectRoot, 'pip_lor_prepared', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'lor', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'lor', 'prepared', 'evidence']),
    }),
    pip_application_filed: await factLandmark(projectRoot, 'pip_application_filed', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'application', 'filed', 'status']),
      acceptedStatuses: ['filed', 'sent', 'confirmed'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'application', 'filed', 'evidence']),
    }),
    pip_lor_sent: await factLandmark(projectRoot, 'pip_lor_sent', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'lor', 'sent', 'status']),
      acceptedStatuses: ['sent', 'confirmed'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'lor', 'sent', 'evidence']),
    }),
    pip_acknowledgment_checked: await factLandmark(projectRoot, 'pip_acknowledgment_checked', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'acknowledgment', 'status']),
      acceptedStatuses: ['checked', 'acknowledged', 'follow_up_needed'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'acknowledgment', 'evidence']),
    }),
    pip_approved: await factLandmark(projectRoot, 'pip_approved', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'approval', 'status']),
      acceptedStatuses: ['approved'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'approval', 'evidence']),
    }),
    pip_status_checked: await factLandmark(projectRoot, 'pip_status_checked', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'status_check', 'status']),
      acceptedStatuses: ['checked', 'complete'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'status_check', 'evidence']),
    }),
    pip_benefits_exhausted: await factLandmark(projectRoot, 'pip_benefits_exhausted', warnings, {
      status: getPath(insuranceState, ['insurance', 'pip', 'benefits', 'status']),
      acceptedStatuses: ['exhausted'],
      evidence: getPath(insuranceState, ['insurance', 'pip', 'benefits', 'evidence']),
    }),
    provider_list_reviewed: await factLandmark(projectRoot, 'provider_list_reviewed', warnings, {
      status: getPath(providersState, ['treatment_status', 'provider_list_reviewed', 'status']),
      acceptedStatuses: ['reviewed', 'complete'],
      evidence: getPath(providersState, ['treatment_status', 'provider_list_reviewed', 'evidence']),
    }),
    provider_status_updated: await factLandmark(projectRoot, 'provider_status_updated', warnings, {
      status: getPath(providersState, ['treatment_status', 'provider_status_updated', 'status']),
      acceptedStatuses: ['updated', 'complete'],
      evidence: getPath(providersState, ['treatment_status', 'provider_status_updated', 'evidence']),
    }),
    provider_followups_flagged: await factLandmark(projectRoot, 'provider_followups_flagged', warnings, {
      status: getPath(providersState, ['treatment_status', 'provider_followups_flagged', 'status']),
      acceptedStatuses: ['flagged', 'none_needed', 'complete'],
      evidence: getPath(providersState, ['treatment_status', 'provider_followups_flagged', 'evidence']),
    }),
    treatment_status_reviewed: await factLandmark(projectRoot, 'treatment_status_reviewed', warnings, {
      status: getPath(providersState, ['treatment_status', 'human_review', 'status']),
      acceptedStatuses: ['reviewed', 'complete'],
      evidence: getPath(providersState, ['treatment_status', 'human_review', 'evidence']),
    }),
    treatment_complete: await factLandmark(projectRoot, 'treatment_complete', warnings, {
      status: getPath(providersState, ['treatment_status', 'treatment_complete', 'status']),
      acceptedStatuses: ['complete', 'confirmed'],
      evidence: getPath(providersState, ['treatment_status', 'treatment_complete', 'evidence']),
    }),
    health_coverage_categorized: await factLandmark(projectRoot, 'health_coverage_categorized', warnings, {
      status: getPath(liensState, ['early_identification', 'health_coverage', 'status']),
      acceptedStatuses: ['categorized', 'complete'],
      evidence: getPath(liensState, ['early_identification', 'health_coverage', 'evidence']),
    }),
    lien_clues_reviewed: await factLandmark(projectRoot, 'lien_clues_reviewed', warnings, {
      status: getPath(liensState, ['early_identification', 'clues_reviewed', 'status']),
      acceptedStatuses: ['reviewed', 'complete'],
      evidence: getPath(liensState, ['early_identification', 'clues_reviewed', 'evidence']),
    }),
    liens_identified: await factLandmark(projectRoot, 'liens_identified', warnings, {
      status: getPath(liensState, ['early_identification', 'liens', 'status']),
      acceptedStatuses: ['identified', 'none_supported', 'complete'],
      evidence: getPath(liensState, ['early_identification', 'liens', 'evidence']),
    }),
    lien_inventory_reviewed: await factLandmark(projectRoot, 'lien_inventory_reviewed', warnings, {
      status: getPath(liensState, ['early_identification', 'inventory_review', 'status']),
      acceptedStatuses: ['reviewed', 'complete'],
      evidence: getPath(liensState, ['early_identification', 'inventory_review', 'evidence']),
    }),
    medical_auth_verified: await factLandmark(projectRoot, 'medical_auth_verified', warnings, {
      status: getPath(recordsState, ['records', 'authorization', 'status']),
      acceptedStatuses: ['verified', 'complete'],
      evidence: getPath(recordsState, ['records', 'authorization', 'evidence']),
    }),
    records_request_packet_prepared: await factLandmark(projectRoot, 'records_request_packet_prepared', warnings, {
      status: getPath(recordsState, ['records', 'request_packet', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(recordsState, ['records', 'request_packet', 'evidence']),
    }),
    records_requested_all_providers: await factLandmark(projectRoot, 'records_requested_all_providers', warnings, {
      status: getPath(recordsState, ['records', 'requests', 'status']),
      acceptedStatuses: ['sent_all', 'requested_all', 'complete'],
      evidence: getPath(recordsState, ['records', 'requests', 'evidence']),
    }),
    first_records_follow_up_complete: await factLandmark(projectRoot, 'first_records_follow_up_complete', warnings, {
      status: getPath(recordsState, ['records', 'followups', 'first', 'status']),
      acceptedStatuses: ['complete', 'not_needed'],
      evidence: getPath(recordsState, ['records', 'followups', 'first', 'evidence']),
    }),
    second_records_follow_up_complete: await factLandmark(projectRoot, 'second_records_follow_up_complete', warnings, {
      status: getPath(recordsState, ['records', 'followups', 'second', 'status']),
      acceptedStatuses: ['complete', 'not_needed'],
      evidence: getPath(recordsState, ['records', 'followups', 'second', 'evidence']),
    }),
    third_records_follow_up_complete: await factLandmark(projectRoot, 'third_records_follow_up_complete', warnings, {
      status: getPath(recordsState, ['records', 'followups', 'third', 'status']),
      acceptedStatuses: ['complete', 'not_needed'],
      evidence: getPath(recordsState, ['records', 'followups', 'third', 'evidence']),
    }),
    records_request_escalated: await factLandmark(projectRoot, 'records_request_escalated', warnings, {
      status: getPath(recordsState, ['records', 'escalation', 'status']),
      acceptedStatuses: ['escalated', 'not_needed', 'complete'],
      evidence: getPath(recordsState, ['records', 'escalation', 'evidence']),
    }),
    records_and_bills_processed: await factLandmark(projectRoot, 'records_and_bills_processed', warnings, {
      status: getPath(recordsState, ['records', 'processing', 'status']),
      acceptedStatuses: ['processed', 'complete'],
      evidence: getPath(recordsState, ['records', 'processing', 'evidence']),
    }),
    all_records_received: await factLandmark(projectRoot, 'all_records_received', warnings, {
      status: getPath(recordsState, ['records', 'received', 'status']),
      acceptedStatuses: ['all_received', 'complete'],
      evidence: getPath(recordsState, ['records', 'received', 'evidence']),
    }),
    medical_chronology_updated: await factLandmark(projectRoot, 'medical_chronology_updated', warnings, {
      status: getPath(recordsState, ['records', 'chronology', 'status']),
      acceptedStatuses: ['updated', 'complete'],
      evidence: getPath(recordsState, ['records', 'chronology', 'evidence']),
    }),
    medical_records_request_workflow_complete: await factLandmark(projectRoot, 'medical_records_request_workflow_complete', warnings, {
      status: getPath(recordsState, ['records', 'workflow_review', 'status']),
      acceptedStatuses: ['complete', 'reviewed'],
      evidence: getPath(recordsState, ['records', 'workflow_review', 'evidence']),
    }),
    demand_materials_gathered: await factLandmark(projectRoot, 'demand_materials_gathered', warnings, {
      status: getPath(demandState, ['demand', 'readiness', 'materials', 'status']),
      acceptedStatuses: ['gathered', 'complete'],
      evidence: getPath(demandState, ['demand', 'readiness', 'materials', 'evidence']),
    }),
    damages_calculated: await factLandmark(projectRoot, 'damages_calculated', warnings, {
      status: getPath(demandState, ['demand', 'readiness', 'damages', 'status']),
      acceptedStatuses: ['calculated', 'complete'],
      evidence: getPath(demandState, ['demand', 'readiness', 'damages', 'evidence']),
    }),
    demand_readiness_reviewed: await factLandmark(projectRoot, 'demand_readiness_reviewed', warnings, {
      status: getPath(demandState, ['demand', 'readiness', 'review', 'status']),
      acceptedStatuses: ['reviewed', 'approved', 'complete'],
      evidence: getPath(demandState, ['demand', 'readiness', 'review', 'evidence']),
    }),
    demand_lien_process_checked: await factLandmark(projectRoot, 'demand_lien_process_checked', warnings, {
      status: getPath(demandState, ['demand', 'liens', 'final_process_check', 'status']),
      acceptedStatuses: ['checked', 'not_needed', 'complete'],
      evidence: getPath(demandState, ['demand', 'liens', 'final_process_check', 'evidence']),
    }),
    demand_drafted: await factLandmark(projectRoot, 'demand_drafted', warnings, {
      status: getPath(demandState, ['demand', 'draft', 'status']),
      acceptedStatuses: ['drafted', 'complete'],
      evidence: getPath(demandState, ['demand', 'draft', 'evidence']),
    }),
    attorney_reviewed_demand: await factLandmark(projectRoot, 'attorney_reviewed_demand', warnings, {
      status: getPath(demandState, ['demand', 'attorney_review', 'status']),
      acceptedStatuses: ['approved', 'reviewed'],
      evidence: getPath(demandState, ['demand', 'attorney_review', 'evidence']),
    }),
    demand_recipients_identified: await factLandmark(projectRoot, 'demand_recipients_identified', warnings, {
      status: getPath(demandState, ['demand', 'recipients', 'status']),
      acceptedStatuses: ['identified', 'complete'],
      evidence: getPath(demandState, ['demand', 'recipients', 'evidence']),
    }),
    demand_sent: await factLandmark(projectRoot, 'demand_sent', warnings, {
      status: demandSentStatus,
      acceptedStatuses: ['sent', 'delivered'],
      evidence: demandSentEvidence,
    }),
    initial_offer_received: await factLandmark(projectRoot, 'initial_offer_received', warnings, {
      status: getPath(negotiationState, ['negotiation', 'initial_offer', 'status']),
      acceptedStatuses: ['received', 'documented'],
      evidence: getPath(negotiationState, ['negotiation', 'initial_offer', 'evidence']),
    }),
    offer_documented: await factLandmark(projectRoot, 'offer_documented', warnings, {
      status: getPath(negotiationState, ['negotiation', 'offer_documented', 'status']),
      acceptedStatuses: ['documented', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'offer_documented', 'evidence']),
    }),
    offer_evaluated: await factLandmark(projectRoot, 'offer_evaluated', warnings, {
      status: getPath(negotiationState, ['negotiation', 'evaluation', 'status']),
      acceptedStatuses: ['evaluated', 'reviewed', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'evaluation', 'evidence']),
    }),
    net_to_client_prepared: await factLandmark(projectRoot, 'net_to_client_prepared', warnings, {
      status: getPath(negotiationState, ['negotiation', 'net_to_client', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'net_to_client', 'evidence']),
    }),
    client_advised_of_offer: await factLandmark(projectRoot, 'client_advised_of_offer', warnings, {
      status: getPath(negotiationState, ['negotiation', 'client_advice', 'status']),
      acceptedStatuses: ['advised', 'reviewed', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'client_advice', 'evidence']),
    }),
    offer_decision_documented: await factLandmark(projectRoot, 'offer_decision_documented', warnings, {
      status: getPath(negotiationState, ['negotiation', 'client_decision', 'status']),
      acceptedStatuses: ['documented', 'accepted', 'countered', 'rejected', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'client_decision', 'evidence']),
    }),
    negotiation_response_prepared: await factLandmark(projectRoot, 'negotiation_response_prepared', warnings, {
      status: getPath(negotiationState, ['negotiation', 'response', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'response', 'prepared', 'evidence']),
    }),
    negotiation_response_human_sent: await factLandmark(projectRoot, 'negotiation_response_human_sent', warnings, {
      status: getPath(negotiationState, ['negotiation', 'response', 'human_sent', 'status']),
      acceptedStatuses: ['sent', 'confirmed'],
      evidence: getPath(negotiationState, ['negotiation', 'response', 'human_sent', 'evidence']),
    }),
    negotiation_result_documented: await factLandmark(projectRoot, 'negotiation_result_documented', warnings, {
      status: getPath(negotiationState, ['negotiation', 'response', 'result', 'status']),
      acceptedStatuses: ['documented', 'accepted', 'countered', 'rejected', 'complete'],
      evidence: getPath(negotiationState, ['negotiation', 'response', 'result', 'evidence']),
    }),
    settlement_reached: await factLandmark(projectRoot, 'settlement_reached', warnings, {
      status: getPath(settlementState, ['settlement', 'status']),
      acceptedStatuses: ['reached', 'signed', 'funded', 'distributed'],
      evidence: getPath(settlementState, ['settlement', 'evidence']),
    }),
    settlement_statement_prepared: await factLandmark(projectRoot, 'settlement_statement_prepared', warnings, {
      status: getPath(settlementState, ['settlement', 'statement', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'statement', 'evidence']),
    }),
    authorization_to_settle_prepared: await factLandmark(projectRoot, 'authorization_to_settle_prepared', warnings, {
      status: getPath(settlementState, ['settlement', 'authorization_to_settle', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'authorization_to_settle', 'evidence']),
    }),
    client_authorized: await factLandmark(projectRoot, 'client_authorized', warnings, {
      status: getPath(settlementState, ['settlement', 'client_authorization', 'status']),
      acceptedStatuses: ['authorized', 'signed', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'client_authorization', 'evidence']),
    }),
    release_executed: await factLandmark(projectRoot, 'release_executed', warnings, {
      status: getPath(settlementState, ['settlement', 'release', 'status']),
      acceptedStatuses: ['executed', 'signed', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'release', 'evidence']),
    }),
    funds_received: await factLandmark(projectRoot, 'funds_received', warnings, {
      status: getPath(settlementState, ['settlement', 'funds', 'status']),
      acceptedStatuses: ['received', 'cleared', 'documented'],
      evidence: getPath(settlementState, ['settlement', 'funds', 'evidence']),
    }),
    settlement_liens_audited: await factLandmark(projectRoot, 'settlement_liens_audited', warnings, {
      status: getPath(settlementState, ['settlement', 'liens', 'audit', 'status']),
      acceptedStatuses: ['audited', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'liens', 'audit', 'evidence']),
    }),
    liens_prioritized: await factLandmark(projectRoot, 'liens_prioritized', warnings, {
      status: getPath(settlementState, ['settlement', 'liens', 'prioritization', 'status']),
      acceptedStatuses: ['prioritized', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'liens', 'prioritization', 'evidence']),
    }),
    lien_available_funds_calculated: await factLandmark(projectRoot, 'lien_available_funds_calculated', warnings, {
      status: getPath(settlementState, ['settlement', 'liens', 'available_funds', 'status']),
      acceptedStatuses: ['calculated', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'liens', 'available_funds', 'evidence']),
    }),
    settlement_lien_strategy_reviewed: await factLandmark(projectRoot, 'settlement_lien_strategy_reviewed', warnings, {
      status: getPath(settlementState, ['settlement', 'liens', 'strategy_review', 'status']),
      acceptedStatuses: ['reviewed', 'approved', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'liens', 'strategy_review', 'evidence']),
    }),
    liens_negotiated: await factLandmark(projectRoot, 'liens_negotiated', warnings, {
      status: getPath(settlementState, ['settlement', 'liens', 'result', 'status']),
      acceptedStatuses: ['negotiated', 'documented', 'none_applicable', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'liens', 'result', 'evidence']),
    }),
    final_distribution_statement_prepared: await factLandmark(projectRoot, 'final_distribution_statement_prepared', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'statement', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'statement', 'evidence']),
    }),
    client_distribution_issued: await factLandmark(projectRoot, 'client_distribution_issued', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'client_issuance', 'status']),
      acceptedStatuses: ['issued', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'client_issuance', 'evidence']),
    }),
    client_distributed: await factLandmark(projectRoot, 'client_distributed', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'client_receipt', 'status']),
      acceptedStatuses: ['confirmed', 'received', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'client_receipt', 'evidence']),
    }),
    trust_account_zeroed: await factLandmark(projectRoot, 'trust_account_zeroed', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'trust_account', 'status']),
      acceptedStatuses: ['zeroed', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'trust_account', 'evidence']),
    }),
    liens_opened: await factLandmark(projectRoot, 'liens_opened', warnings, {
      status: getPath(liensState, ['final_resolution', 'inventory', 'status']),
      acceptedStatuses: ['opened', 'reviewed', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'inventory', 'evidence']),
    }),
    final_amount_request_prepared: await factLandmark(projectRoot, 'final_amount_request_prepared', warnings, {
      status: getPath(liensState, ['final_resolution', 'final_amount_request', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'final_amount_request', 'prepared', 'evidence']),
    }),
    final_amounts_requested: await factLandmark(projectRoot, 'final_amounts_requested', warnings, {
      status: getPath(liensState, ['final_resolution', 'final_amount_request', 'sent', 'status']),
      acceptedStatuses: ['sent', 'requested', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'final_amount_request', 'sent', 'evidence']),
    }),
    final_amounts_received: await factLandmark(projectRoot, 'final_amounts_received', warnings, {
      status: getPath(liensState, ['final_resolution', 'final_amount_receipt', 'status']),
      acceptedStatuses: ['received', 'documented', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'final_amount_receipt', 'evidence']),
    }),
    lien_payment_authorized: await factLandmark(projectRoot, 'lien_payment_authorized', warnings, {
      status: getPath(liensState, ['final_resolution', 'payment_authorization', 'status']),
      acceptedStatuses: ['authorized', 'reviewed', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'payment_authorization', 'evidence']),
    }),
    liens_paid: await factLandmark(projectRoot, 'liens_paid', warnings, {
      status: getPath(liensState, ['final_resolution', 'payment', 'status']),
      acceptedStatuses: ['paid', 'documented', 'complete'],
      evidence: getPath(liensState, ['final_resolution', 'payment', 'evidence']),
    }),
    final_distribution_complete: await factLandmark(projectRoot, 'final_distribution_complete', warnings, {
      status: getPath(settlementState, ['settlement', 'distribution', 'completion', 'status']),
      acceptedStatuses: ['complete'],
      evidence: getPath(settlementState, ['settlement', 'distribution', 'completion', 'evidence']),
    }),
    all_obligations_verified: await factLandmark(projectRoot, 'all_obligations_verified', warnings, {
      status: getPath(settlementState, ['settlement', 'closing', 'readiness', 'status']),
      acceptedStatuses: ['verified', 'complete', 'ready'],
      evidence: getPath(settlementState, ['settlement', 'closing', 'readiness', 'evidence']),
    }),
    final_letter_prepared: await factLandmark(projectRoot, 'final_letter_prepared', warnings, {
      status: getPath(settlementState, ['settlement', 'closing', 'letter', 'prepared', 'status']),
      acceptedStatuses: ['prepared', 'drafted', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'closing', 'letter', 'prepared', 'evidence']),
    }),
    final_letter_sent: await factLandmark(projectRoot, 'final_letter_sent', warnings, {
      status: getPath(settlementState, ['settlement', 'closing', 'letter', 'sent', 'status']),
      acceptedStatuses: ['sent', 'delivered'],
      evidence: getPath(settlementState, ['settlement', 'closing', 'letter', 'sent', 'evidence']),
    }),
    case_archived: await factLandmark(projectRoot, 'case_archived', warnings, {
      status: getPath(settlementState, ['settlement', 'closing', 'archive', 'status']),
      acceptedStatuses: ['archived', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'closing', 'archive', 'evidence']),
    }),
    case_closed: await factLandmark(projectRoot, 'case_closed', warnings, {
      status: getPath(settlementState, ['settlement', 'closing', 'case', 'status']),
      acceptedStatuses: ['closed', 'complete'],
      evidence: getPath(settlementState, ['settlement', 'closing', 'case', 'evidence']),
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
  return {
    schema_version: 1,
    providers_setup: { status: 'not_started', evidence: [] },
    providers: [],
    treatment_status: {
      provider_list_reviewed: { status: 'not_reviewed', evidence: [] },
      provider_status_updated: { status: 'not_started', evidence: [] },
      provider_followups_flagged: { status: 'not_started', evidence: [] },
      human_review: { status: 'not_reviewed', evidence: [] },
      treatment_complete: { status: 'unknown', evidence: [] },
    },
  }
}

function initialInsuranceState(): Record<string, unknown> {
  return {
    schema_version: 1,
    insurance: {
      bi: {
        carrier_identified: { status: 'unknown', evidence: [] },
        lor: {
          prepared: { status: 'not_started', evidence: [] },
          sent: { status: 'not_sent', evidence: [] },
        },
        acknowledgment: { status: 'not_checked', evidence: [] },
      },
      pip: {
        track: { status: 'not_started', evidence: [] },
        carrier_identified: { status: 'unknown', evidence: [] },
        application: {
          prepared: { status: 'not_started', evidence: [] },
          filed: { status: 'not_filed', evidence: [] },
        },
        lor: {
          prepared: { status: 'not_started', evidence: [] },
          sent: { status: 'not_sent', evidence: [] },
        },
        acknowledgment: { status: 'not_checked', evidence: [] },
        approval: { status: 'unknown', evidence: [] },
        status_check: { status: 'not_checked', evidence: [] },
        benefits: { status: 'unknown', evidence: [] },
      },
    },
  }
}

function initialLiensState(): Record<string, unknown> {
  return {
    schema_version: 1,
    liens: [],
    early_identification: {
      health_coverage: { status: 'unknown', evidence: [] },
      clues_reviewed: { status: 'not_reviewed', evidence: [] },
      liens: { status: 'unknown', evidence: [] },
      inventory_review: { status: 'not_reviewed', evidence: [] },
    },
    final_resolution: {
      inventory: { status: 'not_reviewed', evidence: [] },
      final_amount_request: {
        prepared: { status: 'not_started', evidence: [] },
        sent: { status: 'not_sent', evidence: [] },
      },
      final_amount_receipt: { status: 'missing', evidence: [] },
      payment_authorization: { status: 'not_reviewed', evidence: [] },
      payment: { status: 'not_documented', evidence: [] },
    },
  }
}


function initialRecordsState(): Record<string, unknown> {
  return {
    schema_version: 1,
    records: {
      authorization: { status: 'missing', evidence: [] },
      request_packet: { status: 'not_started', evidence: [] },
      requests: { status: 'not_sent', evidence: [] },
      followups: {
        first: { status: 'not_started', evidence: [] },
        second: { status: 'not_started', evidence: [] },
        third: { status: 'not_started', evidence: [] },
      },
      escalation: { status: 'not_started', evidence: [] },
      received: { status: 'missing', evidence: [] },
      processing: { status: 'not_started', evidence: [] },
      chronology: { status: 'not_started', evidence: [] },
      workflow_review: { status: 'not_reviewed', evidence: [] },
    },
  }
}

function initialDemandState(): Record<string, unknown> {
  return {
    schema_version: 1,
    demand: {
      status: 'not_ready',
      blockers: [],
      evidence: [],
      readiness: {
        materials: { status: 'not_started', evidence: [] },
        damages: { status: 'not_started', evidence: [] },
        review: { status: 'not_reviewed', evidence: [] },
      },
      liens: {
        final_process_check: { status: 'not_started', evidence: [] },
      },
      draft: { status: 'not_started', evidence: [] },
      attorney_review: { status: 'not_reviewed', evidence: [] },
      recipients: { status: 'not_started', evidence: [] },
      send: { status: 'not_sent', evidence: [] },
    },
  }
}

function initialNegotiationState(): Record<string, unknown> {
  return {
    schema_version: 1,
    negotiation: {
      initial_offer: { status: 'none', amount: null, evidence: [] },
      offer_documented: { status: 'not_documented', evidence: [] },
      evaluation: { status: 'not_started', evidence: [] },
      net_to_client: { status: 'not_started', evidence: [] },
      client_advice: { status: 'not_started', evidence: [] },
      client_decision: { status: 'not_documented', decision: null, evidence: [] },
      response: {
        prepared: { status: 'not_started', evidence: [] },
        human_sent: { status: 'not_sent', evidence: [] },
        result: { status: 'not_documented', evidence: [] },
      },
    },
  }
}

function initialSettlementState(): Record<string, unknown> {
  return {
    schema_version: 1,
    settlement: {
      status: 'none',
      evidence: [],
      statement: { status: 'not_started', evidence: [] },
      authorization_to_settle: { status: 'not_started', evidence: [] },
      client_authorization: { status: 'not_authorized', evidence: [] },
      release: { status: 'not_executed', evidence: [] },
      funds: { status: 'not_received', evidence: [] },
      liens: {
        audit: { status: 'not_started', evidence: [] },
        prioritization: { status: 'not_started', evidence: [] },
        available_funds: { status: 'not_started', evidence: [] },
        strategy_review: { status: 'not_reviewed', evidence: [] },
        result: { status: 'not_documented', evidence: [] },
      },
      distribution: {
        statement: { status: 'not_started', evidence: [] },
        client_issuance: { status: 'not_issued', evidence: [] },
        client_receipt: { status: 'not_confirmed', evidence: [] },
        trust_account: { status: 'not_zeroed', evidence: [] },
        completion: { status: 'not_started', evidence: [] },
      },
      closing: {
        readiness: { status: 'not_started', evidence: [] },
        letter: {
          prepared: { status: 'not_started', evidence: [] },
          sent: { status: 'not_sent', evidence: [] },
        },
        archive: { status: 'not_archived', evidence: [] },
        case: { status: 'open', evidence: [] },
      },
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

function stateSectionFile(section: FirmVaultCaseStateSectionName): Exclude<FirmVaultStateSection, 'landmarks.yaml'> {
  return `${section}.yaml` as Exclude<FirmVaultStateSection, 'landmarks.yaml'>
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

function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current: Record<string, unknown> = root
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (!isRecord(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  const leaf = path.at(-1)
  if (!leaf) throw new Error('FirmVault fact path cannot be empty')
  current[leaf] = value
}

function normalizeEvidenceRefs(evidence: readonly FirmVaultEvidenceRef[]): readonly FirmVaultEvidenceRef[] {
  return evidence.map((item) => ({
    path: item.path,
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.note ? { note: item.note } : {}),
  }))
}

function firmVaultGuidanceAction(definition: FirmVaultFactDefinition): FirmVaultCaseGuidanceAction {
  const statusHint = definition.allowedStatuses[0] ?? '<status>'
  return {
    fact: definition.fact,
    description: definition.description,
    allowed_statuses: definition.allowedStatuses,
    projected_landmarks: definition.projectedLandmarks,
    command_hint: `waypoint firmvault state set --fact ${definition.fact} --status ${statusHint} --evidence <relative-path> --note <note>`,
  }
}

function classifyFirmVaultGuidanceStage(projection: FirmVaultLandmarkProjection): string {
  const counts = countLandmarks(projection)
  if (counts.satisfied === counts.total) return 'closed'
  if (!projection.landmarks.case_setup_complete.satisfied) return 'intake_not_started'
  if (!projection.landmarks.full_intake_complete.satisfied || !projection.landmarks.accident_report_obtained.satisfied) return 'intake_incomplete'
  if (!projection.landmarks.providers_setup.satisfied) return 'intake_complete'
  if (!projection.landmarks.demand_sent.satisfied) return 'pre_demand'
  if (!projection.landmarks.settlement_reached.satisfied) return 'negotiation'
  if (!projection.landmarks.final_distribution_complete.satisfied) return 'settlement_distribution'
  if (!projection.landmarks.case_closed.satisfied) return 'close_case'
  return 'in_progress'
}

function countLandmarks(projection: FirmVaultLandmarkProjection): FirmVaultLandmarkCounts {
  return {
    satisfied: Object.values(projection.landmarks).filter((landmark) => landmark.satisfied).length,
    total: FIRMVAULT_LANDMARK_SLUGS.length,
  }
}

function diffSatisfiedLandmarks(
  before: FirmVaultLandmarkProjection,
  after: FirmVaultLandmarkProjection,
  targetSatisfied: boolean,
): FirmVaultLandmarkSlug[] {
  return FIRMVAULT_LANDMARK_SLUGS.filter((slug) => before.landmarks[slug].satisfied !== targetSatisfied && after.landmarks[slug].satisfied === targetSatisfied)
}

function acceptedStatusOrFallback(status: unknown, acceptedStatuses: readonly string[], fallback: unknown): unknown {
  if (typeof status === 'string' && acceptedStatuses.includes(status)) return status
  return fallback
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
