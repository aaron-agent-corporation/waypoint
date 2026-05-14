import type { WizardProposedFact, WizardShadowRecord } from './types'

export interface FirmVaultWizardReviewInput {
  shadows: WizardShadowRecord[]
  proposedFacts: WizardProposedFact[]
}

export interface FirmVaultWizardAmbiguity {
  id: string
  kind: 'unknown_classification' | 'duplicate_proposed_fact'
  message: string
  fact?: string
  related_shadow_paths: string[]
}

interface ExpectedFirmVaultDocument {
  fact: string
  categories: string[]
}

const EXPECTED_FIRMVAULT_DOCUMENTS: ExpectedFirmVaultDocument[] = [
  {
    fact: 'client.contracts.fee_agreement',
    categories: ['contracts'],
  },
  {
    fact: 'client.authorizations.hipaa',
    categories: ['authorizations'],
  },
  {
    fact: 'accident.police_report',
    categories: ['accident'],
  },
  {
    fact: 'client.intake',
    categories: ['intake'],
  },
]

export function generateFirmVaultMissingDocumentChecklist(input: FirmVaultWizardReviewInput): string[] {
  const proposedFacts = new Set(input.proposedFacts.map((fact) => fact.fact))
  const observedCategories = new Set(input.shadows.map((shadow) => shadow.classification.kind))

  return EXPECTED_FIRMVAULT_DOCUMENTS.filter((expected) => {
    if (proposedFacts.has(expected.fact)) return false
    return !expected.categories.some((category) => observedCategories.has(category))
  }).map((expected) => expected.fact)
}

export function detectFirmVaultWizardAmbiguities(input: FirmVaultWizardReviewInput): FirmVaultWizardAmbiguity[] {
  const ambiguities: FirmVaultWizardAmbiguity[] = []

  for (const shadow of input.shadows) {
    if (shadow.classification.kind !== 'unknown') continue

    ambiguities.push({
      id: nextAmbiguityId(ambiguities.length),
      kind: 'unknown_classification',
      message: 'Shadow requires classification review before it can support a FirmVault fact.',
      related_shadow_paths: [shadow.shadow_path],
    })
  }

  const factsByName = new Map<string, WizardProposedFact[]>()
  for (const fact of input.proposedFacts) {
    const existing = factsByName.get(fact.fact) ?? []
    existing.push(fact)
    factsByName.set(fact.fact, existing)
  }

  for (const [fact, facts] of Array.from(factsByName.entries())) {
    if (facts.length < 2) continue

    ambiguities.push({
      id: nextAmbiguityId(ambiguities.length),
      kind: 'duplicate_proposed_fact',
      fact,
      message: 'Multiple shadows propose the same FirmVault fact; ask which evidence should be used before apply.',
      related_shadow_paths: facts.map((candidate) => candidate.evidence_shadow),
    })
  }

  return ambiguities
}

function nextAmbiguityId(index: number): string {
  return `ambiguity-${String(index + 1).padStart(3, '0')}`
}
