import { describe, expect, it } from 'vitest'

import {
  detectFirmVaultWizardAmbiguities,
  generateFirmVaultMissingDocumentChecklist,
} from '../firmvault-review'
import type { WizardProposedFact, WizardShadowRecord } from '../types'

function shadow(kind: string, filename: string): WizardShadowRecord {
  return {
    id: `shadow-${filename}`,
    domain: 'firmvault',
    shadow_path: `.waypoint/shadows/firmvault/${kind}/${filename}.md`,
    source: {
      path: `/tmp/source/${filename}.pdf`,
      root_relative_path: `${filename}.pdf`,
      sha256: `hash-${filename}`,
      size_bytes: 123,
      media_type: 'application/pdf',
      discovered_at: '2026-05-14T00:00:00.000Z',
    },
    classification: {
      kind,
      confidence: kind === 'unknown' ? 'low' : 'high',
      rationale: `test ${kind}`,
      review_required: kind === 'unknown',
    },
    review_status: 'pending',
  }
}

function proposedFact(id: string, fact: string, evidenceShadow: string): WizardProposedFact {
  return {
    id,
    fact,
    status: 'proposed',
    evidence_shadow: evidenceShadow,
    source_path: `/tmp/source/${id}.pdf`,
    confidence: 'high',
    review_required: true,
    approved: false,
  }
}

describe('FirmVault Wizard review helpers', () => {
  it('reports missing expected documents from current shadows and proposed facts', () => {
    const checklist = generateFirmVaultMissingDocumentChecklist({
      shadows: [
        shadow('contracts', 'Fee Agreement'),
        shadow('authorizations', 'HIPAA Authorization'),
      ],
      proposedFacts: [
        proposedFact(
          'proposed-fact-001',
          'client.contracts.fee_agreement',
          '.waypoint/shadows/firmvault/contracts/Fee Agreement.md',
        ),
      ],
    })

    expect(checklist).toEqual(['accident.police_report', 'client.intake'])
  })

  it('detects unknown shadows and duplicate proposed facts as review ambiguities', () => {
    const ambiguities = detectFirmVaultWizardAmbiguities({
      shadows: [shadow('unknown', 'Mystery Scan')],
      proposedFacts: [
        proposedFact(
          'proposed-fact-001',
          'client.contracts.fee_agreement',
          '.waypoint/shadows/firmvault/contracts/Fee Agreement.md',
        ),
        proposedFact(
          'proposed-fact-002',
          'client.contracts.fee_agreement',
          '.waypoint/shadows/firmvault/contracts/Fee Agreement Duplicate.md',
        ),
      ],
    })

    expect(ambiguities).toEqual([
      {
        id: 'ambiguity-001',
        kind: 'unknown_classification',
        message: 'Shadow requires classification review before it can support a FirmVault fact.',
        related_shadow_paths: ['.waypoint/shadows/firmvault/unknown/Mystery Scan.md'],
      },
      {
        id: 'ambiguity-002',
        kind: 'duplicate_proposed_fact',
        fact: 'client.contracts.fee_agreement',
        message: 'Multiple shadows propose the same FirmVault fact; ask which evidence should be used before apply.',
        related_shadow_paths: [
          '.waypoint/shadows/firmvault/contracts/Fee Agreement.md',
          '.waypoint/shadows/firmvault/contracts/Fee Agreement Duplicate.md',
        ],
      },
    ])
  })
})
