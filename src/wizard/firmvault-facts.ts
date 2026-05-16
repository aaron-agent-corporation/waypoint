import type { WizardOrganizedDocumentEntry, WizardProposedFact, WizardShadowRecord } from './types'

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

    proposedFacts.push(buildFirmVaultProposedFact({
      index: proposedFacts.length,
      fact,
      evidenceShadow: shadow.shadow_path,
      sourcePath: shadow.source.path,
      confidence: shadow.classification.confidence,
    }))
  }

  return proposedFacts
}

export function proposeFirmVaultFactsFromOrganizedDocuments(
  documents: WizardOrganizedDocumentEntry[],
): WizardProposedFact[] {
  const proposedFacts: WizardProposedFact[] = []

  for (const document of documents) {
    const fact = findFirmVaultFactForShadow({
      id: document.id,
      domain: document.domain,
      shadow_path: document.shadow_path,
      source: document.source,
      classification: document.classification,
      review_status: document.review_status,
    })
    if (!fact) continue

    proposedFacts.push(buildFirmVaultProposedFact({
      index: proposedFacts.length,
      fact,
      evidenceShadow: document.shadow_path,
      sourcePath: document.source.path,
      confidence: document.classification.confidence,
      canonicalDocumentPath: document.canonical_document_path,
      copiedEvidencePath: document.copy_decision.status === 'copied'
        ? document.copy_decision.destination_path ?? document.canonical_document_path
        : undefined,
    }))
  }

  return proposedFacts
}

function buildFirmVaultProposedFact(input: {
  index: number
  fact: string
  evidenceShadow: string
  sourcePath: string
  confidence: WizardProposedFact['confidence']
  canonicalDocumentPath?: string
  copiedEvidencePath?: string
}): WizardProposedFact {
  return {
    id: `proposed-fact-${String(input.index + 1).padStart(3, '0')}`,
    fact: input.fact,
    status: 'proposed',
    evidence_shadow: input.evidenceShadow,
    source_path: input.sourcePath,
    canonical_document_path: input.canonicalDocumentPath,
    copied_evidence_path: input.copiedEvidencePath,
    confidence: input.confidence,
    review_required: true,
    approved: false,
  }
}
