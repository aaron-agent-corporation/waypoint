import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { stringify as yamlStringify } from 'yaml'

import { assertWithinRoot, safeWizardArtifactPath } from './paths.ts'
import type {
  WizardAdoptionPlan,
  WizardAnswer,
  WizardDomain,
  WizardProposedFact,
  WizardQuestion,
  WizardShadowRecord,
  WizardOrganizedDocumentEntry,
  WizardOrganizationPlan,
} from './types.ts'

export interface BuildWizardAdoptionPlanInput {
  domain: WizardDomain
  sourceRoot: string
  targetCaseRoot: string
  shadows: WizardShadowRecord[]
  proposedFacts: WizardProposedFact[]
  questions: WizardQuestion[]
  answers: WizardAnswer[]
  missingExpectedDocuments: string[]
  warnings: string[]
  organizationPlan?: WizardOrganizationPlan
}

export interface WriteWizardAdoptionPlanInput {
  caseRoot: string
  plan: WizardAdoptionPlan
}

export interface WriteWizardAdoptionPlanResult {
  path: string
  relative_path: string
  proposed_facts_written: number
}

const ADOPTION_PLAN_RELATIVE_PATH = safeWizardArtifactPath('adoption-plan.yaml')

function summarizeApprovals(proposedFacts: WizardProposedFact[]) {
  return {
    approved_facts: proposedFacts.filter((fact) => fact.approved).length,
    unapproved_facts: proposedFacts.filter((fact) => !fact.approved).length,
  }
}

function organizationDocumentsByShadow(
  organizationPlan: WizardOrganizationPlan | undefined,
): Map<string, WizardOrganizedDocumentEntry> {
  const documents = new Map<string, WizardOrganizedDocumentEntry>()
  for (const document of organizationPlan?.documents ?? []) {
    documents.set(document.shadow_path, document)
  }
  return documents
}

function copiedEvidencePath(document: WizardOrganizedDocumentEntry | undefined): string | undefined {
  if (!document || document.copy_decision.status !== 'copied') return undefined
  return document.copy_decision.destination_path ?? document.canonical_document_path
}

function enrichProposedFactWithOrganization(
  fact: WizardProposedFact,
  documents: Map<string, WizardOrganizedDocumentEntry>,
): WizardProposedFact {
  const document = documents.get(fact.evidence_shadow)
  return {
    ...fact,
    canonical_document_path: fact.canonical_document_path ?? document?.canonical_document_path,
    copied_evidence_path: fact.copied_evidence_path ?? copiedEvidencePath(document),
    approved: false,
  }
}

export function buildWizardAdoptionPlan(input: BuildWizardAdoptionPlanInput): WizardAdoptionPlan {
  const organizedDocuments = organizationDocumentsByShadow(input.organizationPlan)
  const proposedFacts = input.proposedFacts.map((fact) => enrichProposedFactWithOrganization(fact, organizedDocuments))
  const classifications = Array.from(
    input.shadows.reduce((summaries, shadow) => {
      const existing = summaries.get(shadow.classification.kind) ?? {
        kind: shadow.classification.kind,
        count: 0,
        review_required: 0,
      }
      existing.count += 1
      if (shadow.classification.review_required) {
        existing.review_required += 1
      }
      summaries.set(shadow.classification.kind, existing)
      return summaries
    }, new Map<string, { kind: string; count: number; review_required: number }>()),
  )
    .map(([, summary]) => summary)
    .sort((a, b) => a.kind.localeCompare(b.kind))

  return {
    schema_version: 1,
    domain: input.domain,
    source_root: input.sourceRoot,
    target_case_root: input.targetCaseRoot,
    source_inventory: {
      files_found: input.shadows.length,
      files: input.shadows.map((shadow) => ({ ...shadow.source })),
    },
    shadow_map: input.shadows.map((shadow) => {
      const organizedDocument = organizedDocuments.get(shadow.shadow_path)
      return {
        shadow_path: shadow.shadow_path,
        source_path: shadow.source.path,
        source_sha256: shadow.source.sha256,
        classification_kind: shadow.classification.kind,
        review_status: shadow.review_status,
        canonical_document_path: organizedDocument?.canonical_document_path,
        copied_evidence_path: copiedEvidencePath(organizedDocument),
        copy_status: organizedDocument?.copy_decision.status,
      }
    }),
    classifications,
    shadows: [...input.shadows],
    proposed_facts: proposedFacts,
    questions: [...input.questions],
    answers: [...input.answers],
    q_and_a: {
      questions_total: input.questions.length,
      questions_pending: input.questions.filter((question) => question.status === 'pending').length,
      answers_total: input.answers.length,
    },
    missing_expected_documents: [...input.missingExpectedDocuments].sort(),
    warnings: [...input.warnings],
    approvals: summarizeApprovals(proposedFacts),
    safety: {
      external_side_effects: 'forbidden',
      source_mutation: 'forbidden',
      domain_facts_from_shadows: 'forbidden',
    },
  }
}

export function approveWizardProposedFacts(
  plan: WizardAdoptionPlan,
  factRefs: string[],
): WizardAdoptionPlan {
  const approvedRefs = new Set(factRefs)
  const proposedFacts = plan.proposed_facts.map((fact) => ({
    ...fact,
    approved: approvedRefs.has(fact.id) || approvedRefs.has(fact.fact),
  }))

  return {
    ...plan,
    proposed_facts: proposedFacts,
    approvals: summarizeApprovals(proposedFacts),
  }
}

export async function writeWizardAdoptionPlan(
  input: WriteWizardAdoptionPlanInput,
): Promise<WriteWizardAdoptionPlanResult> {
  const caseRoot = path.resolve(input.caseRoot)
  const outputPath = path.resolve(caseRoot, ADOPTION_PLAN_RELATIVE_PATH)
  assertWithinRoot(caseRoot, outputPath)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, yamlStringify(input.plan), 'utf8')

  return {
    path: outputPath,
    relative_path: ADOPTION_PLAN_RELATIVE_PATH,
    proposed_facts_written: input.plan.proposed_facts.length,
  }
}
