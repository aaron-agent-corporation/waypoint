export const WIZARD_DOMAINS = ['firmvault'] as const
export type WizardDomain = (typeof WIZARD_DOMAINS)[number]

export type WizardConfidence = 'low' | 'medium' | 'high'
export type WizardReviewStatus = 'pending' | 'approved' | 'rejected'
export type WizardQuestionStatus = 'pending' | 'answered' | 'skipped'

export interface WizardSourcePointer {
  path: string
  root_relative_path?: string
  sha256: string
  size_bytes: number
  media_type?: string
  discovered_at: string
}

export interface WizardSourceFile extends WizardSourcePointer {
  extension?: string
  media_hint?: string
}

export interface WizardClassification {
  kind: string
  confidence: WizardConfidence
  rationale: string
  review_required?: boolean
}

export interface WizardPiiMetadata {
  masked: boolean
  strategy: string
  raw_text_included?: boolean
  source_content_policy?: 'not_copied' | 'masked_excerpt' | 'summary_only'
  notes?: string[]
}

export interface WizardExtractionMetadata {
  status: 'stub' | 'extracted' | 'failed'
  method: string
  raw_text_included: boolean
  notes?: string[]
}

export interface WizardShadowDocumentFrontmatter {
  schema_version: 1
  shadow_type: 'document'
  domain: WizardDomain
  source: WizardSourcePointer
  pii: WizardPiiMetadata
  extraction?: WizardExtractionMetadata
  classification: WizardClassification
  waypoint: {
    canonical_path: string
    proposed_facts?: string[]
  }
  review: {
    status: WizardReviewStatus
    questions?: string[]
  }
}

export interface WizardShadowRecord {
  id: string
  domain: WizardDomain
  shadow_path: string
  source: WizardSourcePointer
  classification: WizardClassification
  review_status: WizardReviewStatus
}

export interface WizardQuestion {
  id: string
  prompt: string
  status: WizardQuestionStatus
  domain: WizardDomain
  related_shadow_paths?: string[]
  fact?: string
  created_at?: string
}

export interface WizardAnswer {
  question_id: string
  answer: string
  answered_at: string
  answered_by?: string
}

export interface WizardProposedFact {
  id: string
  fact: string
  status: string
  evidence_shadow: string
  source_path: string
  confidence: WizardConfidence
  review_required: boolean
  approved: boolean
}

export interface WizardScanResult {
  schema_version: 1
  domain: WizardDomain
  source_root: string
  files_found: number
  files: WizardSourceFile[]
  warnings: string[]
}

export interface WizardPlanSourceInventory {
  files_found: number
  files: WizardSourcePointer[]
}

export interface WizardPlanShadowMapEntry {
  shadow_path: string
  source_path: string
  source_sha256: string
  classification_kind: string
  review_status: WizardReviewStatus
}

export interface WizardPlanClassificationSummary {
  kind: string
  count: number
  review_required: number
}

export interface WizardPlanQuestionAnswerSummary {
  questions_total: number
  questions_pending: number
  answers_total: number
}

export interface WizardPlanApprovalSummary {
  approved_facts: number
  unapproved_facts: number
}

export interface WizardAdoptionPlan {
  schema_version: 1
  domain: WizardDomain
  source_root: string
  target_case_root: string
  source_inventory: WizardPlanSourceInventory
  shadow_map: WizardPlanShadowMapEntry[]
  classifications: WizardPlanClassificationSummary[]
  shadows: WizardShadowRecord[]
  proposed_facts: WizardProposedFact[]
  questions: WizardQuestion[]
  answers: WizardAnswer[]
  q_and_a: WizardPlanQuestionAnswerSummary
  missing_expected_documents: string[]
  warnings: string[]
  approvals: WizardPlanApprovalSummary
  safety: {
    external_side_effects: 'forbidden'
    source_mutation: 'forbidden'
    legal_facts_from_shadows: 'forbidden'
  }
}

export type WizardOrganizeCopyMode = 'shadow_only' | 'copy_requested'
export type WizardOrganizeCopyStatus = 'planned' | 'copied' | 'skipped'

export interface WizardOrganizeCopyDecision {
  mode: WizardOrganizeCopyMode
  status: WizardOrganizeCopyStatus
  destination_path?: string
  reason?: string
}

export interface WizardOrganizeLegalBoundary {
  legal_facts_from_organization: 'forbidden'
  legal_facts_from_copied_files: 'forbidden'
  requires_approved_apply: boolean
}

export interface WizardOrganizedDocumentEntry {
  id: string
  domain: WizardDomain
  source: WizardSourcePointer
  canonical_document_path: string
  shadow_path: string
  classification: WizardClassification
  review_status: WizardReviewStatus
  copy_decision: WizardOrganizeCopyDecision
  legal_boundary: WizardOrganizeLegalBoundary
}

export interface WizardOrganizationPlan {
  schema_version: 1
  domain: WizardDomain
  source_root: string
  target_case_root: string
  generated_at: string
  source_files_read_only: true
  legal_facts_from_organization: 'forbidden'
  documents: WizardOrganizedDocumentEntry[]
  warnings: string[]
}

export function isWizardDomain(value: unknown): value is WizardDomain {
  return typeof value === 'string' && WIZARD_DOMAINS.includes(value as WizardDomain)
}

export function isSafeWizardRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\')) {
    return false
  }

  if (value.includes('\\')) {
    return false
  }

  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return false
  }

  return value.startsWith('.waypoint/shadows/') || value.startsWith('.waypoint/wizard/')
}

export function createWizardSourcePointer(pointer: WizardSourcePointer): WizardSourcePointer {
  return { ...pointer }
}
