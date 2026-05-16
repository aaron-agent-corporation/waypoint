import type { WizardClassification, WizardSourceFile } from './types'

export const FIRMVAULT_SHADOW_CATEGORIES = [
  'intake',
  'contracts',
  'authorizations',
  'accident',
  'insurance',
  'providers',
  'medical-records',
  'bills',
  'liens',
  'demand',
  'negotiation',
  'settlement',
  'closing',
  'correspondence',
  'unknown',
] as const

export type FirmVaultShadowCategory = (typeof FIRMVAULT_SHADOW_CATEGORIES)[number]

interface FirmVaultClassifierRule {
  category: FirmVaultShadowCategory
  keywords: string[]
  rationale: string
}

const FIRMVAULT_CLASSIFIER_RULES: FirmVaultClassifierRule[] = [
  {
    category: 'intake',
    keywords: ['intake', 'client intake', 'new client', 'case questionnaire'],
    rationale: 'deterministic filename/path keyword match for intake documents',
  },
  {
    category: 'contracts',
    keywords: ['fee agreement', 'engagement', 'retainer', 'contract', 'agreement'],
    rationale: 'deterministic filename/path keyword match for client contracts',
  },
  {
    category: 'authorizations',
    keywords: ['hipaa', 'authorization', 'authorisation', 'consent', 'release form'],
    rationale: 'deterministic filename/path keyword match for authorizations',
  },
  {
    category: 'accident',
    keywords: ['police report', 'accident', 'crash', 'incident', 'collision'],
    rationale: 'deterministic filename/path keyword match for accident documents',
  },
  {
    category: 'insurance',
    keywords: ['insurance', 'policy', 'declaration', 'declarations', 'coverage', 'carrier', 'bi carrier', 'pip carrier'],
    rationale: 'deterministic filename/path keyword match for insurance documents',
  },
  {
    category: 'bills',
    keywords: ['bill', 'bills', 'invoice', 'statement', 'balance due', 'ledger charges'],
    rationale: 'deterministic filename/path keyword match for bills',
  },
  {
    category: 'medical-records',
    keywords: ['medical record', 'medical records', 'records', 'treatment', 'chart note', 'visit note', 'progress note'],
    rationale: 'deterministic filename/path keyword match for medical records',
  },
  {
    category: 'providers',
    keywords: ['provider', 'provider list', 'doctor', 'clinic', 'hospital', 'chiropractor', 'therapist'],
    rationale: 'deterministic filename/path keyword match for provider documents',
  },
  {
    category: 'liens',
    keywords: ['lien', 'subrogation', 'medicare', 'medicaid', 'health plan claim'],
    rationale: 'deterministic filename/path keyword match for liens',
  },
  {
    category: 'demand',
    keywords: ['demand', 'demand package', 'demand letter'],
    rationale: 'deterministic filename/path keyword match for demand documents',
  },
  {
    category: 'negotiation',
    keywords: ['negotiation', 'offer', 'counteroffer', 'counter offer'],
    rationale: 'deterministic filename/path keyword match for negotiation documents',
  },
  {
    category: 'settlement',
    keywords: ['settlement', 'settlement check', 'settlement statement', 'release executed', 'payment', 'disbursement', 'settlement release'],
    rationale: 'deterministic filename/path keyword match for settlement documents',
  },
  {
    category: 'closing',
    keywords: ['closing', 'closing letter', 'archive', 'final letter', 'case closed', 'final distribution', 'trust zero'],
    rationale: 'deterministic filename/path keyword match for closing documents',
  },
  {
    category: 'correspondence',
    keywords: ['letter', 'email', 'memo', 'correspondence', 'notice'],
    rationale: 'deterministic filename/path keyword match for correspondence',
  },
]

export function isFirmVaultShadowCategory(value: unknown): value is FirmVaultShadowCategory {
  return (
    typeof value === 'string' &&
    FIRMVAULT_SHADOW_CATEGORIES.includes(value as FirmVaultShadowCategory)
  )
}

function matchesFirmVaultKeyword(candidateText: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(candidateText)
}

export function classifyFirmVaultSourceFile(file: WizardSourceFile): WizardClassification {
  const candidateText = [file.root_relative_path, file.path, file.extension]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()

  for (const rule of FIRMVAULT_CLASSIFIER_RULES) {
    if (rule.keywords.some((keyword) => matchesFirmVaultKeyword(candidateText, keyword))) {
      return {
        kind: rule.category,
        confidence: 'high',
        rationale: rule.rationale,
        review_required: false,
      }
    }
  }

  return {
    kind: 'unknown',
    confidence: 'low',
    rationale: 'deterministic filename/path rules found no FirmVault category match',
    review_required: true,
  }
}
