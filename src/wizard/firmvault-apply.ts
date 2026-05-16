import type { WizardAdoptionPlan, WizardProposedFact } from './types'

export interface WizardApplyEvidenceRef {
  readonly path: string
  readonly kind?: string
  readonly note?: string
}

export interface WizardApplyStateResult {
  readonly fact: string
  readonly file?: string
  readonly status: string
  readonly evidence: readonly WizardApplyEvidenceRef[]
  readonly landmarksBefore?: { readonly satisfied: number; readonly total: number }
  readonly landmarksAfter?: { readonly satisfied: number; readonly total: number }
  readonly newlySatisfied?: readonly string[]
  readonly newlyUnsatisfied?: readonly string[]
  readonly projection?: unknown
}

export interface WizardApplyGuidanceResult {
  readonly stage: string
  readonly landmarks?: { readonly satisfied: number; readonly total: number }
  readonly next_actions?: unknown
  readonly warnings?: readonly string[]
}

export interface WizardApplyAppliedFact {
  readonly id: string
  readonly fact: string
  readonly status: string
  readonly evidence_shadow: string
  readonly source_path: string
  readonly state_result: WizardApplyStateResult
}

export interface WizardApplySkippedFact {
  readonly id: string
  readonly fact: string
  readonly status: string
  readonly evidence_shadow: string
  readonly source_path: string
  readonly reason: 'unapproved'
}

export interface WizardApplyResult {
  readonly schema_version: 1
  readonly domain: 'firmvault'
  readonly case_root: string
  readonly applied_facts: readonly WizardApplyAppliedFact[]
  readonly skipped_facts: readonly WizardApplySkippedFact[]
  readonly guidance: WizardApplyGuidanceResult | null
}

export interface ApplyFirmVaultWizardPlanInput {
  readonly caseRoot: string
  readonly plan: WizardAdoptionPlan
  readonly setFirmVaultCaseFact: (
    caseRoot: string,
    input: {
      readonly fact: string
      readonly status: string
      readonly evidence: readonly WizardApplyEvidenceRef[]
      readonly note?: string
    },
  ) => Promise<WizardApplyStateResult>
  readonly getFirmVaultCaseGuidance?: (caseRoot: string) => Promise<WizardApplyGuidanceResult>
}

export async function applyFirmVaultWizardPlan(input: ApplyFirmVaultWizardPlanInput): Promise<WizardApplyResult> {
  if (input.plan.domain !== 'firmvault') {
    throw new Error(`Unsupported Wizard apply domain: ${input.plan.domain}`)
  }

  const appliedFacts: WizardApplyAppliedFact[] = []
  const skippedFacts: WizardApplySkippedFact[] = []

  for (const proposedFact of input.plan.proposed_facts) {
    if (!proposedFact.approved) {
      skippedFacts.push(skippedFact(proposedFact, 'unapproved'))
      continue
    }

    const status = normalizeWizardFactStatus(proposedFact)
    const stateResult = await input.setFirmVaultCaseFact(input.caseRoot, {
      fact: proposedFact.fact,
      status,
      evidence: wizardFactEvidence(proposedFact),
      note: `Applied by Waypoint Wizard from ${proposedFact.evidence_shadow}`,
    })

    appliedFacts.push({
      id: proposedFact.id,
      fact: proposedFact.fact,
      status,
      evidence_shadow: proposedFact.evidence_shadow,
      source_path: proposedFact.source_path,
      state_result: stateResult,
    })
  }

  const guidance = input.getFirmVaultCaseGuidance
    ? await input.getFirmVaultCaseGuidance(input.caseRoot)
    : null

  return {
    schema_version: 1,
    domain: 'firmvault',
    case_root: input.caseRoot,
    applied_facts: appliedFacts,
    skipped_facts: skippedFacts,
    guidance,
  }
}

function wizardFactEvidence(proposedFact: WizardProposedFact): WizardApplyEvidenceRef[] {
  const evidence: WizardApplyEvidenceRef[] = [{
    path: proposedFact.evidence_shadow,
    kind: 'wizard_shadow',
    note: `Waypoint Wizard shadow for source ${proposedFact.source_path}`,
  }]

  if (proposedFact.copied_evidence_path) {
    evidence.push({
      path: proposedFact.copied_evidence_path,
      kind: 'wizard_copied_document',
      note: 'Waypoint Wizard organized copied source document',
    })
  }

  return evidence
}

function normalizeWizardFactStatus(proposedFact: WizardProposedFact): string {
  if (proposedFact.status !== 'proposed') {
    return proposedFact.status
  }

  if (proposedFact.fact === 'client.contracts.fee_agreement' || proposedFact.fact === 'client.authorizations.hipaa') {
    return 'signed'
  }

  if (proposedFact.fact === 'accident.police_report') {
    return 'received'
  }

  return proposedFact.status
}

function skippedFact(proposedFact: WizardProposedFact, reason: WizardApplySkippedFact['reason']): WizardApplySkippedFact {
  return {
    id: proposedFact.id,
    fact: proposedFact.fact,
    status: proposedFact.status,
    evidence_shadow: proposedFact.evidence_shadow,
    source_path: proposedFact.source_path,
    reason,
  }
}
