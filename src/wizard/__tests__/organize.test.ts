import { describe, expect, expectTypeOf, it } from 'vitest'

import { createWizardOrganizedDocumentEntry } from '../organize'
import type {
  WizardOrganizeCopyDecision,
  WizardOrganizedDocumentEntry,
  WizardOrganizeLegalBoundary,
  WizardOrganizationPlan,
} from '../types'

describe('Waypoint Wizard organize mode contracts', () => {
  it('represents copied document destinations, shadows, source pointers, classification, review, and legal boundaries', () => {
    const entry = createWizardOrganizedDocumentEntry({
      id: 'doc-001',
      domain: 'firmvault',
      source: {
        path: '/tmp/messy-case/Scan 001.pdf',
        root_relative_path: 'raw scans/Scan 001.pdf',
        sha256: 'a'.repeat(64),
        size_bytes: 2048,
        media_type: 'application/pdf',
        discovered_at: '2026-05-14T00:00:00.000Z',
      },
      canonical_document_path: 'documents/intake/scan-001.pdf',
      shadow_path: '.waypoint/shadows/firmvault/intake/scan-001.md',
      classification: {
        kind: 'intake',
        confidence: 'medium',
        rationale: 'filename mentions intake scan',
        review_required: true,
      },
      review_status: 'pending',
      copy_decision: {
        mode: 'copy_requested',
        status: 'planned',
        destination_path: 'documents/intake/scan-001.pdf',
      },
      legal_boundary: {
        legal_facts_from_organization: 'forbidden',
        legal_facts_from_copied_files: 'forbidden',
        requires_approved_apply: true,
      },
    })

    expect(entry).toEqual({
      id: 'doc-001',
      domain: 'firmvault',
      source: {
        path: '/tmp/messy-case/Scan 001.pdf',
        root_relative_path: 'raw scans/Scan 001.pdf',
        sha256: 'a'.repeat(64),
        size_bytes: 2048,
        media_type: 'application/pdf',
        discovered_at: '2026-05-14T00:00:00.000Z',
      },
      canonical_document_path: 'documents/intake/scan-001.pdf',
      shadow_path: '.waypoint/shadows/firmvault/intake/scan-001.md',
      classification: {
        kind: 'intake',
        confidence: 'medium',
        rationale: 'filename mentions intake scan',
        review_required: true,
      },
      review_status: 'pending',
      copy_decision: {
        mode: 'copy_requested',
        status: 'planned',
        destination_path: 'documents/intake/scan-001.pdf',
      },
      legal_boundary: {
        legal_facts_from_organization: 'forbidden',
        legal_facts_from_copied_files: 'forbidden',
        requires_approved_apply: true,
      },
    })
  })

  it('exports durable organize plan contract shapes for later writer and CLI slices', () => {
    expectTypeOf<WizardOrganizeCopyDecision>().toMatchTypeOf<{
      mode: 'copy_requested' | 'shadow_only'
      status: 'planned' | 'copied' | 'skipped'
      destination_path?: string
    }>()
    expectTypeOf<WizardOrganizeLegalBoundary>().toMatchTypeOf<{
      legal_facts_from_organization: 'forbidden'
      legal_facts_from_copied_files: 'forbidden'
      requires_approved_apply: boolean
    }>()
    expectTypeOf<WizardOrganizedDocumentEntry>().toMatchTypeOf<{
      source: { path: string; sha256: string }
      canonical_document_path: string
      shadow_path: string
      review_status: 'pending' | 'approved' | 'rejected'
    }>()
    expectTypeOf<WizardOrganizationPlan>().toMatchTypeOf<{
      schema_version: 1
      source_files_read_only: true
      legal_facts_from_organization: 'forbidden'
      documents: WizardOrganizedDocumentEntry[]
    }>()
  })
})
