import { describe, expect, it } from 'vitest'

import { proposeFirmVaultFactsFromShadows } from '../firmvault-facts'
import type { WizardShadowRecord } from '../types'

function shadow(kind: string, filename: string): WizardShadowRecord {
  return {
    id: `shadow-${filename}`,
    domain: 'firmvault',
    shadow_path: `/tmp/case/.waypoint/shadows/firmvault/${kind}/${filename}.md`,
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

describe('FirmVault Wizard proposed fact mapper', () => {
  it('proposes review-only FirmVault facts from classified shadows without approving them', () => {
    const facts = proposeFirmVaultFactsFromShadows([
      shadow('contracts', 'Fee Agreement'),
      shadow('authorizations', 'HIPAA Authorization'),
      shadow('accident', 'Police Report'),
      shadow('unknown', 'Mystery Scan'),
    ])

    expect(facts).toHaveLength(3)
    expect(facts.map((fact) => fact.fact)).toEqual([
      'client.contracts.fee_agreement',
      'client.authorizations.hipaa',
      'accident.police_report',
    ])

    expect(facts[0]).toMatchObject({
      id: 'proposed-fact-001',
      fact: 'client.contracts.fee_agreement',
      status: 'proposed',
      evidence_shadow: '/tmp/case/.waypoint/shadows/firmvault/contracts/Fee Agreement.md',
      source_path: '/tmp/source/Fee Agreement.pdf',
      confidence: 'high',
      review_required: true,
      approved: false,
    })

    expect(facts.every((fact) => fact.review_required === true)).toBe(true)
    expect(facts.every((fact) => fact.approved === false)).toBe(true)
  })

  it('proposes no facts for categories that require later clarification or richer extraction', () => {
    const facts = proposeFirmVaultFactsFromShadows([
      shadow('intake', 'Intake Docs'),
      shadow('medical-records', 'Records'),
      shadow('bills', 'Bills'),
      shadow('unknown', 'Scan 001'),
    ])

    expect(facts).toEqual([])
  })
})
