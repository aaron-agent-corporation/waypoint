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
  notes?: string[]
}

export interface WizardShadowDocumentFrontmatter {
  schema_version: 1
  shadow_type: 'document'
  domain: WizardDomain
  source: WizardSourcePointer
  pii: WizardPiiMetadata
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

export interface WizardAdoptionPlan {
  schema_version: 1
  domain: WizardDomain
  source_root: string
  target_case_root: string
  shadows: WizardShadowRecord[]
  proposed_facts: WizardProposedFact[]
  questions: WizardQuestion[]
  answers: WizardAnswer[]
  missing_expected_documents: string[]
  warnings: string[]
  safety: {
    external_side_effects: 'forbidden'
    source_mutation: 'forbidden'
    legal_facts_from_shadows: 'forbidden'
  }
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
