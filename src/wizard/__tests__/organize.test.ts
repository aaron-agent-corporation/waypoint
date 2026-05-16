import { describe, expect, expectTypeOf, it } from 'vitest'

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as yamlParse } from 'yaml'

import {
  buildWizardOrganizationPlan,
  createWizardOrganizedDocumentEntry,
  firmVaultOrganizationCategoryForFact,
  writeWizardOrganizationPlan,
  writeWizardOrganizedCasePackage,
} from '../organize'
import { classifyFirmVaultSourceFile } from '../firmvault-classifier'
import { FIRMVAULT_FACT_DEFINITIONS } from '../../../packages/waypoint-folder-host/src/firmvault/facts'
import type {
  WizardOrganizeCopyDecision,
  WizardOrganizedDocumentEntry,
  WizardOrganizeLegalBoundary,
  WizardOrganizationPlan,
  WizardShadowRecord,
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

  it('writes the clean case skeleton, document indexes, source manifest, report, checklist, and organization plan', async () => {
    const plan = buildWizardOrganizationPlan({
      domain: 'firmvault',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows: [
        shadowRecord({
          id: 'shadow-001',
          filename: 'Insurance Policy.pdf',
          kind: 'insurance',
          confidence: 'high',
          reviewRequired: false,
          shadowPath: '.waypoint/shadows/firmvault/insurance/insurance-policy.md',
        }),
        shadowRecord({
          id: 'shadow-002',
          filename: 'Mystery Upload.pdf',
          kind: 'unknown',
          confidence: 'low',
          reviewRequired: true,
          shadowPath: '.waypoint/shadows/firmvault/unknown/mystery-upload.md',
        }),
      ],
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-organized-case-'))
    try {
      const result = await writeWizardOrganizedCasePackage({ caseRoot, plan })

      expect(result).toEqual({
        case_root: caseRoot,
        directories_created: expect.arrayContaining([
          'documents/insurance',
          'documents/unknown',
          '.waypoint/wizard',
        ]),
        artifacts: expect.arrayContaining([
          'README.md',
          'documents/insurance/README.md',
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

      expect(await readFile(join(caseRoot, 'README.md'), 'utf8')).toContain('Waypoint Wizard organized case package')
      expect(await readFile(join(caseRoot, 'documents/insurance/README.md'), 'utf8')).toContain('Insurance Policy.pdf')
      expect(await readFile(join(caseRoot, 'documents/unknown/README.md'), 'utf8')).toContain('Mystery Upload.pdf')

      const sourceManifest = yamlParse(await readFile(join(caseRoot, '.waypoint/wizard/source-manifest.yaml'), 'utf8')) as {
        source_files_read_only: boolean
        legal_facts_from_organization: string
        files: Array<{ source_path: string; canonical_document_path: string }>
      }
      expect(sourceManifest.source_files_read_only).toBe(true)
      expect(sourceManifest.legal_facts_from_organization).toBe('forbidden')
      expect(sourceManifest.files.map((file) => file.canonical_document_path)).toEqual([
        'documents/insurance/insurance-policy.pdf',
        'documents/unknown/mystery-upload.pdf',
      ])

      const report = await readFile(join(caseRoot, '.waypoint/wizard/organize-report.md'), 'utf8')
      expect(report).toContain('Source files copied: 0')
      expect(report).toContain('Legal facts from organization: forbidden')

      const checklist = await readFile(join(caseRoot, '.waypoint/wizard/missing-documents-checklist.md'), 'utf8')
      expect(checklist).toContain('- [ ] Review unknown files in `documents/unknown/`')
      expect(checklist).toContain('organize-q-001')

      expect(await readdir(join(caseRoot, 'documents'))).toEqual(['insurance', 'unknown'])
    } finally {
      await rm(caseRoot, { recursive: true, force: true })
    }
  })

  it('copies source files into deterministic canonical destinations only when explicitly requested', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'waypoint-messy-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-organized-copy-'))

    try {
      const insuranceSource = join(sourceRoot, 'Insurance Policy.pdf')
      const billSource = join(sourceRoot, 'Insurance Policy (copy).pdf')
      await writeFile(insuranceSource, 'policy bytes', 'utf8')
      await writeFile(billSource, 'bill bytes', 'utf8')
      const beforeSourceHashes = await sourceTreeHashes(sourceRoot)

      const plan = buildWizardOrganizationPlan({
        domain: 'firmvault',
        sourceRoot,
        targetCaseRoot: caseRoot,
        shadows: [
          shadowRecord({
            id: 'shadow-001',
            filename: 'Insurance Policy.pdf',
            kind: 'insurance',
            confidence: 'high',
            reviewRequired: false,
            shadowPath: '.waypoint/shadows/firmvault/insurance/insurance-policy.md',
          }),
          shadowRecord({
            id: 'shadow-002',
            filename: 'Insurance Policy (copy).pdf',
            kind: 'insurance',
            confidence: 'high',
            reviewRequired: false,
            shadowPath: '.waypoint/shadows/firmvault/insurance/insurance-policy-copy.md',
          }),
        ],
        generatedAt: '2026-05-14T12:00:00.000Z',
      })
      plan.documents[0]!.source.path = billSource
      plan.documents[0]!.source.root_relative_path = 'Insurance Policy (copy).pdf'
      plan.documents[0]!.source.sha256 = beforeSourceHashes['Insurance Policy (copy).pdf']!
      plan.documents[0]!.canonical_document_path = 'documents/insurance/insurance-policy.pdf'
      plan.documents[0]!.copy_decision.destination_path = 'documents/insurance/insurance-policy.pdf'
      plan.documents[1]!.source.path = insuranceSource
      plan.documents[1]!.source.root_relative_path = 'Insurance Policy.pdf'
      plan.documents[1]!.source.sha256 = beforeSourceHashes['Insurance Policy.pdf']!
      plan.documents[1]!.canonical_document_path = 'documents/insurance/insurance-policy.pdf'
      plan.documents[1]!.copy_decision.destination_path = 'documents/insurance/insurance-policy.pdf'

      const result = await writeWizardOrganizedCasePackage({ caseRoot, plan, copyFiles: true })

      expect(result.source_files_copied).toBe(2)
      expect(result.documents_copied).toEqual([
        'documents/insurance/insurance-policy.pdf',
        'documents/insurance/insurance-policy-002.pdf',
      ])
      expect(await readFile(join(caseRoot, 'documents/insurance/insurance-policy.pdf'), 'utf8')).toBe('bill bytes')
      expect(await readFile(join(caseRoot, 'documents/insurance/insurance-policy-002.pdf'), 'utf8')).toBe('policy bytes')
      expect(await sourceTreeHashes(sourceRoot)).toEqual(beforeSourceHashes)

      const copiedPlan = yamlParse(await readFile(join(caseRoot, '.waypoint/wizard/organization-plan.yaml'), 'utf8')) as WizardOrganizationPlan
      expect(copiedPlan.documents.map((document) => document.copy_decision)).toEqual([
        {
          mode: 'copy_requested',
          status: 'copied',
          destination_path: 'documents/insurance/insurance-policy.pdf',
          source_sha256_verified: beforeSourceHashes['Insurance Policy (copy).pdf'],
        },
        {
          mode: 'copy_requested',
          status: 'copied',
          destination_path: 'documents/insurance/insurance-policy-002.pdf',
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

  it('organizes FirmVault personal-injury packets with fact-derived checklist sections and review questions', async () => {
    const shadows: WizardShadowRecord[] = [
      shadowRecord({
        id: 'shadow-001',
        filename: 'Signed Fee Agreement.pdf',
        kind: classifyFirmVaultSourceFile(sourceFile('Signed Fee Agreement.pdf')).kind,
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/firmvault/contracts/signed-fee-agreement.md',
      }),
      shadowRecord({
        id: 'shadow-002',
        filename: 'Progressive BI Insurance Declarations.pdf',
        kind: classifyFirmVaultSourceFile(sourceFile('Progressive BI Insurance Declarations.pdf')).kind,
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/firmvault/insurance/progressive-bi-insurance-declarations.md',
      }),
      shadowRecord({
        id: 'shadow-003',
        filename: 'Physical Therapy Bill.pdf',
        kind: classifyFirmVaultSourceFile(sourceFile('Physical Therapy Bill.pdf')).kind,
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/firmvault/bills/physical-therapy-bill.md',
      }),
      shadowRecord({
        id: 'shadow-004',
        filename: 'Settlement Release Signed.pdf',
        kind: classifyFirmVaultSourceFile(sourceFile('Settlement Release Signed.pdf')).kind,
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/firmvault/settlement/settlement-release-signed.md',
      }),
      shadowRecord({
        id: 'shadow-005',
        filename: 'Random Upload.pdf',
        kind: classifyFirmVaultSourceFile(sourceFile('Random Upload.pdf')).kind,
        confidence: 'low',
        reviewRequired: true,
        shadowPath: '.waypoint/shadows/firmvault/unknown/random-upload.md',
      }),
    ]

    const plan = buildWizardOrganizationPlan({
      domain: 'firmvault',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows,
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    expect(plan.documents.map((document) => document.canonical_document_path)).toEqual([
      'documents/bills/physical-therapy-bill.pdf',
      'documents/contracts/signed-fee-agreement.pdf',
      'documents/insurance/progressive-bi-insurance-declarations.pdf',
      'documents/settlement/settlement-release-signed.pdf',
      'documents/unknown/random-upload.pdf',
    ])
    expect(plan.questions).toEqual([
      expect.objectContaining({
        id: 'organize-q-001',
        prompt: 'What canonical FirmVault document category should Random Upload.pdf use?',
        related_shadow_paths: ['.waypoint/shadows/firmvault/unknown/random-upload.md'],
      }),
    ])

    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-organize-'))
    try {
      await writeWizardOrganizedCasePackage({ caseRoot, plan })
      const checklist = await readFile(join(caseRoot, '.waypoint/wizard/missing-documents-checklist.md'), 'utf8')
      expect(checklist).toContain('## FirmVault fact-derived checklist')
      expect(checklist).toContain('- [x] contracts — current package includes 1 document(s)')
      expect(checklist).toContain('- [ ] intake — no organized documents yet')
      expect(checklist).toContain('  - `client.intake`: Client intake information is complete.')
      expect(checklist).toContain('- [x] insurance — current package includes 1 document(s)')
      expect(checklist).toContain('- [x] bills — current package includes 1 document(s)')
      expect(checklist).toContain('- [x] settlement — current package includes 1 document(s)')
      expect(checklist).toContain('- [ ] closing — no organized documents yet')
      expect(checklist).toContain('  - `settlement.closing.case`: Case closure has been documented.')
    } finally {
      await rm(caseRoot, { recursive: true, force: true })
    }

    const unmappedFacts = FIRMVAULT_FACT_DEFINITIONS
      .map((definition) => definition.fact)
      .filter((fact) => firmVaultOrganizationCategoryForFact(fact) === 'unknown')
    expect(unmappedFacts).toEqual([])
  })

  it('builds and writes a deterministic shadow-only organization plan without copying source files', async () => {
    const shadows: WizardShadowRecord[] = [
      shadowRecord({
        id: 'shadow-002',
        filename: 'Mystery Upload.pdf',
        kind: 'unknown',
        confidence: 'low',
        reviewRequired: true,
        shadowPath: '.waypoint/shadows/firmvault/unknown/mystery-upload.md',
      }),
      shadowRecord({
        id: 'shadow-001',
        filename: 'Insurance Policy.pdf',
        kind: 'insurance',
        confidence: 'high',
        reviewRequired: false,
        shadowPath: '.waypoint/shadows/firmvault/insurance/insurance-policy.md',
      }),
    ]

    const plan = buildWizardOrganizationPlan({
      domain: 'firmvault',
      sourceRoot: '/tmp/messy-case',
      targetCaseRoot: '/tmp/organized-case',
      shadows,
      generatedAt: '2026-05-14T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      schema_version: 1,
      domain: 'firmvault',
      source_root: '/tmp/messy-case',
      target_case_root: '/tmp/organized-case',
      generated_at: '2026-05-14T12:00:00.000Z',
      source_files_read_only: true,
      legal_facts_from_organization: 'forbidden',
      questions: [
        {
          id: 'organize-q-001',
          status: 'pending',
          prompt: 'What canonical FirmVault document category should Mystery Upload.pdf use?',
          related_shadow_paths: ['.waypoint/shadows/firmvault/unknown/mystery-upload.md'],
        },
      ],
    })
    expect(plan.documents.map((document) => document.id)).toEqual(['doc-001', 'doc-002'])
    expect(plan.documents.map((document) => document.canonical_document_path)).toEqual([
      'documents/insurance/insurance-policy.pdf',
      'documents/unknown/mystery-upload.pdf',
    ])
    expect(plan.documents.every((document) => document.copy_decision.mode === 'shadow_only')).toBe(true)
    expect(plan.documents.every((document) => document.copy_decision.status === 'skipped')).toBe(true)
    expect(plan.documents.every((document) => document.legal_boundary.legal_facts_from_copied_files === 'forbidden')).toBe(true)
    expect(plan.warnings).toContain('Unknown or ambiguous source files were assigned to documents/unknown/ and require Wizard review.')

    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-organize-plan-'))
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
        'documents/insurance/insurance-policy.pdf',
        'documents/unknown/mystery-upload.pdf',
      ])
      expect(parsed.source_files_read_only).toBe(true)
      expect(parsed.legal_facts_from_organization).toBe('forbidden')
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

function sourceFile(filename: string) {
  return {
    path: `/tmp/messy-case/${filename}`,
    root_relative_path: filename,
    sha256: 'f'.repeat(64),
    size_bytes: 1024,
    media_type: 'application/pdf',
    discovered_at: '2026-05-14T00:00:00.000Z',
    extension: '.pdf',
  }
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
    domain: 'firmvault',
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
