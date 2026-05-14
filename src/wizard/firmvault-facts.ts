import type { WizardProposedFact, WizardShadowRecord } from './types'

interface FirmVaultFactMapping {
  fact: string
  category: string
  keywords: string[]
}

const FIRMVAULT_FACT_MAPPINGS: FirmVaultFactMapping[] = [
  {
    category: 'contracts',
    fact: 'client.contracts.fee_agreement',
    keywords: ['fee agreement', 'retainer', 'engagement agreement'],
  },
  {
    category: 'authorizations',
    fact: 'client.authorizations.hipaa',
    keywords: ['hipaa'],
  },
  {
    category: 'accident',
    fact: 'accident.police_report',
    keywords: ['police report'],
  },
]

function normalizeFactCandidate(shadow: WizardShadowRecord): string {
  return [shadow.shadow_path, shadow.source.root_relative_path, shadow.source.path]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
}

function matchesKeyword(candidateText: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(candidateText)
}

function findFirmVaultFactForShadow(shadow: WizardShadowRecord): string | null {
  const candidateText = normalizeFactCandidate(shadow)

  const mapping = FIRMVAULT_FACT_MAPPINGS.find(
    (candidate) =>
      candidate.category === shadow.classification.kind &&
      candidate.keywords.some((keyword) => matchesKeyword(candidateText, keyword)),
  )

  return mapping?.fact ?? null
}

export function proposeFirmVaultFactsFromShadows(shadows: WizardShadowRecord[]): WizardProposedFact[] {
  const proposedFacts: WizardProposedFact[] = []

  for (const shadow of shadows) {
    const fact = findFirmVaultFactForShadow(shadow)
    if (!fact) continue

    proposedFacts.push({
      id: `proposed-fact-${String(proposedFacts.length + 1).padStart(3, '0')}`,
      fact,
      status: 'proposed',
      evidence_shadow: shadow.shadow_path,
      source_path: shadow.source.path,
      confidence: shadow.classification.confidence,
      review_required: true,
      approved: false,
    })
  }

  return proposedFacts
}
