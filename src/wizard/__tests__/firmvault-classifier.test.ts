import { describe, expect, it } from 'vitest'

import {
  FIRMVAULT_SHADOW_CATEGORIES,
  classifyFirmVaultSourceFile,
  isFirmVaultShadowCategory,
} from '../firmvault-classifier'
import type { WizardSourceFile } from '../types'

function sourceFile(rootRelativePath: string): WizardSourceFile {
  return {
    path: `/tmp/messy-case/${rootRelativePath}`,
    root_relative_path: rootRelativePath,
    sha256: `hash-${rootRelativePath}`,
    size_bytes: 123,
    media_type: 'application/pdf',
    extension: '.pdf',
    media_hint: 'application/pdf',
    discovered_at: '2026-05-14T00:00:00.000Z',
  }
}

describe('FirmVault Wizard classifier', () => {
  it('exports the canonical FirmVault shadow categories from the PRD', () => {
    expect(FIRMVAULT_SHADOW_CATEGORIES).toEqual([
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
    ])

    expect(isFirmVaultShadowCategory('medical-records')).toBe(true)
    expect(isFirmVaultShadowCategory('medical')).toBe(false)
  })

  it.each([
    ['Intake Docs.pdf', 'intake'],
    ['Fee Agreement.pdf', 'contracts'],
    ['HIPAA Authorization.pdf', 'authorizations'],
    ['Police Report.pdf', 'accident'],
    ['Insurance declarations.pdf', 'insurance'],
    ['Dr Smith Provider Info.pdf', 'providers'],
    ['Medical Records.pdf', 'medical-records'],
    ['Medical Bills.pdf', 'bills'],
    ['Lien Notice.pdf', 'liens'],
    ['Demand Package.pdf', 'demand'],
    ['Negotiation Notes.pdf', 'negotiation'],
    ['Settlement Check.pdf', 'settlement'],
    ['Closing Letter.pdf', 'closing'],
    ['Email from Client.pdf', 'correspondence'],
    ['scan001.bin', 'unknown'],
  ])('classifies %s as %s using deterministic filename/path rules', (filename, expectedKind) => {
    const classification = classifyFirmVaultSourceFile(sourceFile(filename))

    expect(classification.kind).toBe(expectedKind)
    expect(classification.rationale).toContain('deterministic')
    expect(classification.confidence).toBe(expectedKind === 'unknown' ? 'low' : 'high')
    expect(classification.review_required).toBe(expectedKind === 'unknown')
  })
})
