import { describe, expect, expectTypeOf, it } from 'vitest'

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as yamlParse } from 'yaml'

import {
  buildWizardOrganizationPlan,
  createWizardOrganizedDocumentEntry,
  writeWizardOrganizationPlan,
  writeWizardOrganizedCasePackage,
} from '../organize.ts'
import type {
  WizardOrganizeCopyDecision,
  WizardOrganizedDocumentEntry,
  WizardOrganizeDomainBoundary,
  WizardOrganizationPlan,
  WizardShadowRecord,
} from '../types.ts'

describe('Wizard organize mode contracts', () => {
  it('represents copied document destinations, shadows, source pointers, classification, review, and domain boundaries', () => {
    const entry = createWizardOrganizedDocumentEntry({
      id: 'doc-001',
      domain: 'documents',
      source: {
        path: '/tmp/messy-case/Scan 001.pdf',
        root_relative_path: 'raw scans/Scan 001.pdf',
        sha256: 'a'.repeat(64),
        size_bytes: 2048,
        media_type: 'application/pdf',
        discovered_at: '2026-05-14T00:00:00.000Z',
      },
      canonical_document_path: 'documents/intake/scan-001.pdf',
      shadow_path: '.waypoint/shadows/documents/intake/scan-001.md',
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
      domain_boundary: {
        domain_facts_from_organization: 'forbidden',
        domain_facts_from_copied_files: 'forbidden',
        requires_approved_apply: true,
      },
    })

    expect(entry).toEqual({
      id: 'doc-001',
      domain: 'documents',
      source: {
        path: '/tmp/messy-case/Scan 001.pdf',
        root_relative_path: 'raw scans/Scan 001.pdf',
        sha256: 'a'.repeat(64),
        size_bytes: 2048,
        media_type: 'application/pdf',
        discovered_at: '2026-05-14T00:00:00.000Z',
      },
      canonical_document_path: 'documents/intake/scan-001.pdf',
      shadow_path: '.waypoint/shadows/documents/intake/scan-001.md',
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
      domain_boundary: {
        domain_facts_from_organization: 'forbidden',
        domain_facts_from_copied_files: 'forbidden',
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
    expectTypeOf<WizardOrganizeDomainBoundary>().toMatchTypeOf<{
      domain_facts_from_organization: 'forbidden'
      domain_facts_from_copied_files: 'forbidden'
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
      domain_facts_from_organization: 'forbidden'
      documents: WizardOrganizedDocumentEntry[]
    }>()
  })

  it('writes the clean case skeleton, document indexes, source manifest, report, checklist, and organization plan', async () => {
    const plan = buildWizardOrganizationPlan({
      domain: 'documents',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows: [
        shadowRecord({
          id: 'shadow-001',
          filename: 'Insurance Policy.pdf',
          kind: 'documents',
          confidence: 'high',
          reviewRequired: false,
          shadowPath: '.waypoint/shadows/documents/documents/insurance-policy.md',
        }),
        shadowRecord({
          id: 'shadow-002',
          filename: 'Mystery Upload.pdf',
          kind: 'unknown',
          confidence: 'low',
          reviewRequired: true,
          shadowPath: '.waypoint/shadows/documents/unknown/mystery-upload.md',
        }),
      ],
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    const caseRoot = await mkdtemp(join(tmpdir(), 'runner-organized-case-'))
    try {
      const result = await writeWizardOrganizedCasePackage({ caseRoot, plan })

      expect(result).toEqual({
        case_root: caseRoot,
        directories_created: expect.arrayContaining([
          'documents/documents',
          'documents/unknown',
          '.waypoint/wizard',
        ]),
        artifacts: expect.arrayContaining([
          'README.md',
          'documents/documents/README.md',
          'documents/unknown/README.md',
          '.waypoint/wizard/source-manifest.yaml',
          '.waypoint/wizard/organization-plan.yaml',
          '.waypoint/wizard/organize-report.md',
          '.waypoint/wizard/missing-documents-checklist.md',
        ]),
        documents_planned: 2,
        source_files_copied: 0,
        documents_copied: [],
      })

      expect(await readFile(join(caseRoot, 'README.md'), 'utf8')).toContain('Wizard organized case package')
      expect(await readFile(join(caseRoot, 'documents/documents/README.md'), 'utf8')).toContain('Insurance Policy.pdf')
      expect(await readFile(join(caseRoot, 'documents/unknown/README.md'), 'utf8')).toContain('Mystery Upload.pdf')

      const sourceManifest = yamlParse(await readFile(join(caseRoot, '.waypoint/wizard/source-manifest.yaml'), 'utf8')) as {
        source_files_read_only: boolean
        domain_facts_from_organization: string
        files: Array<{ source_path: string; canonical_document_path: string }>
      }
      expect(sourceManifest.source_files_read_only).toBe(true)
      expect(sourceManifest.domain_facts_from_organization).toBe('forbidden')
      expect(sourceManifest.files.map((file) => file.canonical_document_path)).toEqual([
        'documents/documents/insurance-policy.pdf',
        'documents/unknown/mystery-upload.pdf',
      ])

      const report = await readFile(join(caseRoot, '.waypoint/wizard/organize-report.md'), 'utf8')
      expect(report).toContain('Source files copied: 0')
      expect(report).toContain('Domain facts from organization: forbidden')

      const checklist = await readFile(join(caseRoot, '.waypoint/wizard/missing-documents-checklist.md'), 'utf8')
      expect(checklist).toContain('- [ ] Review unknown files in `documents/unknown/`')
      expect(checklist).toContain('organize-q-001')

      expect(await readdir(join(caseRoot, 'documents'))).toEqual(['documents', 'unknown'])
    } finally {
      await rm(caseRoot, { recursive: true, force: true })
    }
  })

  it('copies source files into deterministic canonical destinations only when explicitly requested', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'runner-messy-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'runner-organized-copy-'))

    try {
      const insuranceSource = join(sourceRoot, 'Insurance Policy.pdf')
      const billSource = join(sourceRoot, 'Insurance Policy (copy).pdf')
      await writeFile(insuranceSource, 'policy bytes', 'utf8')
      await writeFile(billSource, 'bill bytes', 'utf8')
      const beforeSourceHashes = await sourceTreeHashes(sourceRoot)

      const plan = buildWizardOrganizationPlan({
        domain: 'documents',
        sourceRoot,
        targetCaseRoot: caseRoot,
        shadows: [
          shadowRecord({
            id: 'shadow-001',
            filename: 'Insurance Policy.pdf',
            kind: 'documents',
            confidence: 'high',
            reviewRequired: false,
            shadowPath: '.waypoint/shadows/documents/documents/insurance-policy.md',
          }),
          shadowRecord({
            id: 'shadow-002',
            filename: 'Insurance Policy (copy).pdf',
            kind: 'documents',
            confidence: 'high',
            reviewRequired: false,
            shadowPath: '.waypoint/shadows/documents/documents/insurance-policy-copy.md',
          }),
        ],
        generatedAt: '2026-05-14T12:00:00.000Z',
      })
      plan.documents[0]!.source.path = billSource
      plan.documents[0]!.source.root_relative_path = 'Insurance Policy (copy).pdf'
      plan.documents[0]!.source.sha256 = beforeSourceHashes['Insurance Policy (copy).pdf']!
      plan.documents[0]!.canonical_document_path = 'documents/documents/insurance-policy.pdf'
      plan.documents[0]!.copy_decision.destination_path = 'documents/documents/insurance-policy.pdf'
      plan.documents[1]!.source.path = insuranceSource
      plan.documents[1]!.source.root_relative_path = 'Insurance Policy.pdf'
      plan.documents[1]!.source.sha256 = beforeSourceHashes['Insurance Policy.pdf']!
      plan.documents[1]!.canonical_document_path = 'documents/documents/insurance-policy.pdf'
      plan.documents[1]!.copy_decision.destination_path = 'documents/documents/insurance-policy.pdf'

      const result = await writeWizardOrganizedCasePackage({ caseRoot, plan, copyFiles: true })

      expect(result.source_files_copied).toBe(2)
      expect(result.documents_copied).toEqual([
        'documents/documents/insurance-policy.pdf',
        'documents/documents/insurance-policy-002.pdf',
      ])
      expect(await readFile(join(caseRoot, 'documents/documents/insurance-policy.pdf'), 'utf8')).toBe('bill bytes')
      expect(await readFile(join(caseRoot, 'documents/documents/insurance-policy-002.pdf'), 'utf8')).toBe('policy bytes')
      expect(await sourceTreeHashes(sourceRoot)).toEqual(beforeSourceHashes)

      const copiedPlan = yamlParse(await readFile(join(caseRoot, '.waypoint/wizard/organization-plan.yaml'), 'utf8')) as WizardOrganizationPlan
      expect(copiedPlan.documents.map((document) => document.copy_decision)).toEqual([
        {
          mode: 'copy_requested',
          status: 'copied',
          destination_path: 'documents/documents/insurance-policy.pdf',
          source_sha256_verified: beforeSourceHashes['Insurance Policy (copy).pdf'],
        },
        {
          mode: 'copy_requested',
          status: 'copied',
          destination_path: 'documents/documents/insurance-policy-002.pdf',
          source_sha256_verified: beforeSourceHashes['Insurance Policy.pdf'],
        },
      ])

      const sourceManifest = yamlParse(await readFile(join(caseRoot, '.waypoint/wizard/source-manifest.yaml'), 'utf8')) as {
        files: Array<{ copied_sha256?: string; canonical_document_path: string }>
      }
      expect(sourceManifest.files.map((file) => file.copied_sha256)).toEqual([
        beforeSourceHashes['Insurance Policy (copy).pdf'],
        beforeSourceHashes['Insurance Policy.pdf'],
      ])
    } finally {
      await rm(sourceRoot, { recursive: true, force: true })
      await rm(caseRoot, { recursive: true, force: true })
    }
  })

  it('assigns every recognized bucket its own category and asks about unrecognized files', async () => {
    const shadows: WizardShadowRecord[] = [
      shadowRecord({
        id: 'shadow-001',
        filename: 'Signed Agreement.pdf',
        kind: 'documents',
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/documents/documents/signed-agreement.md',
      }),
      shadowRecord({
        id: 'shadow-002',
        filename: 'Site Photo.png',
        kind: 'images',
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/documents/images/site-photo.md',
      }),
      shadowRecord({
        id: 'shadow-003',
        filename: 'Random Upload.bin',
        kind: 'other',
        confidence: 'low',
        reviewRequired: true,
        shadowPath: '.waypoint/shadows/documents/unknown/random-upload.md',
      }),
    ]

    const plan = buildWizardOrganizationPlan({
      domain: 'documents',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows,
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    expect(plan.documents.map((document) => document.canonical_document_path)).toEqual([
      'documents/documents/signed-agreement.pdf',
      'documents/images/site-photo.png',
      'documents/unknown/random-upload.bin',
    ])
    expect(plan.questions).toEqual([
      expect.objectContaining({
        id: 'organize-q-001',
        prompt: 'What canonical document category should Random Upload.bin use?',
        related_shadow_paths: ['.waypoint/shadows/documents/unknown/random-upload.md'],
      }),
    ])
  })

  it('builds and writes a deterministic shadow-only organization plan without copying source files', async () => {
    const shadows: WizardShadowRecord[] = [
      shadowRecord({
        id: 'shadow-002',
        filename: 'Mystery Upload.pdf',
        kind: 'unknown',
        confidence: 'low',
        reviewRequired: true,
        shadowPath: '.waypoint/shadows/documents/unknown/mystery-upload.md',
      }),
      shadowRecord({
        id: 'shadow-001',
        filename: 'Insurance Policy.pdf',
        kind: 'documents',
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/documents/documents/insurance-policy.md',
      }),
    ]

    const plan = buildWizardOrganizationPlan({
      domain: 'documents',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows,
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      schema_version: 1,
      domain: 'documents',
      source_root: '/tmp/messy-case',
      target_case_root: '/tmp/organized-case',
      generated_at: '2026-05-14T12:00:00.000Z',
      source_files_read_only: true,
      domain_facts_from_organization: 'forbidden',
      questions: [
        {
          id: 'organize-q-001',
          status: 'pending',
          prompt: 'What canonical document category should Mystery Upload.pdf use?',
          related_shadow_paths: ['.waypoint/shadows/documents/unknown/mystery-upload.md'],
        },
      ],
    })
    expect(plan.documents.map((document) => document.id)).toEqual(['doc-001', 'doc-002'])
    expect(plan.documents.map((document) => document.canonical_document_path)).toEqual([
      'documents/documents/insurance-policy.pdf',
      'documents/unknown/mystery-upload.pdf',
    ])
    expect(plan.documents.every((document) => document.copy_decision.mode === 'shadow_only')).toBe(true)
    expect(plan.documents.every((document) => document.copy_decision.status === 'skipped')).toBe(true)
    expect(plan.documents.every((document) => document.domain_boundary.domain_facts_from_copied_files === 'forbidden')).toBe(true)
    expect(plan.warnings).toContain('Unknown or ambiguous source files were assigned to documents/unknown/ and require Wizard review.')

    const caseRoot = await mkdtemp(join(tmpdir(), 'runner-organize-plan-'))
    try {
      const result = await writeWizardOrganizationPlan({ caseRoot, plan })
      expect(result).toEqual({
        path: join(caseRoot, '.waypoint/wizard/organization-plan.yaml'),
        relative_path: '.waypoint/wizard/organization-plan.yaml',
        documents_planned: 2,
        source_files_copied: 0,
      })
      const parsed = yamlParse(await readFile(result.path, 'utf8')) as WizardOrganizationPlan
      expect(parsed.documents.map((document) => document.canonical_document_path)).toEqual([
        'documents/documents/insurance-policy.pdf',
        'documents/unknown/mystery-upload.pdf',
      ])
      expect(parsed.source_files_read_only).toBe(true)
      expect(parsed.domain_facts_from_organization).toBe('forbidden')
    } finally {
      await rm(caseRoot, { recursive: true, force: true })
    }
  })
})

async function sourceTreeHashes(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { withFileTypes: true })
  const hashes: Record<string, string> = {}

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const content = await readFile(join(root, entry.name))
    hashes[entry.name] = createHash('sha256').update(content).digest('hex')
  }

  return hashes
}

function shadowRecord(input: {
  id: string
  filename: string
  kind: string
  confidence: 'low' | 'medium' | 'high'
  reviewRequired: boolean
  shadowPath: string
}): WizardShadowRecord {
  return {
    id: input.id,
    domain: 'documents',
    shadow_path: input.shadowPath,
    source: {
      path: `/tmp/messy-case/${input.filename}`,
      root_relative_path: input.filename,
      sha256: input.id.padEnd(64, '0'),
      size_bytes: 1024,
      media_type: 'application/pdf',
      discovered_at: '2026-05-14T00:00:00.000Z',
    },
    classification: {
      kind: input.kind,
      confidence: input.confidence,
      rationale: `${input.kind} fixture`,
      review_required: input.reviewRequired,
    },
    review_status: 'pending',
  }
}
