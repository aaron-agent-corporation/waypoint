import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { stringify as yamlStringify } from 'yaml'

import { assertWithinRoot, safeWizardArtifactPath, slugifyWizardPathSegment } from './paths'
import {
  isSafeWizardRelativePath,
  isWizardDomain,
  type WizardDomain,
  type WizardOrganizedDocumentEntry,
  type WizardOrganizationPlan,
  type WizardQuestion,
  type WizardShadowRecord,
} from './types'

export type CreateWizardOrganizedDocumentEntryInput = WizardOrganizedDocumentEntry

export interface BuildWizardOrganizationPlanInput {
  domain: WizardDomain
  sourceRoot: string
  targetCaseRoot: string
  shadows: WizardShadowRecord[]
  generatedAt?: string
}

export interface WriteWizardOrganizationPlanInput {
  caseRoot: string
  plan: WizardOrganizationPlan
}

export interface WriteWizardOrganizationPlanResult {
  path: string
  relative_path: string
  documents_planned: number
  source_files_copied: number
}

const ORGANIZATION_PLAN_RELATIVE_PATH = safeWizardArtifactPath('organization-plan.yaml')

export function createWizardOrganizedDocumentEntry(
  input: CreateWizardOrganizedDocumentEntryInput,
): WizardOrganizedDocumentEntry {
  if (!isWizardDomain(input.domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(input.domain)}`)
  }

  assertSafeOrganizeRelativePath(input.canonical_document_path, 'canonical document path')

  if (!isSafeWizardRelativePath(input.shadow_path)) {
    throw new Error(`Unsafe Wizard shadow path: ${input.shadow_path}`)
  }

  if (input.copy_decision.destination_path) {
    assertSafeOrganizeRelativePath(input.copy_decision.destination_path, 'copy destination path')
  }

  return {
    ...input,
    source: { ...input.source },
    classification: { ...input.classification },
    copy_decision: { ...input.copy_decision },
    legal_boundary: { ...input.legal_boundary },
  }
}

export function buildWizardOrganizationPlan(input: BuildWizardOrganizationPlanInput): WizardOrganizationPlan {
  if (!isWizardDomain(input.domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(input.domain)}`)
  }

  const orderedShadows = [...input.shadows].sort((a, b) => {
    const byKind = a.classification.kind.localeCompare(b.classification.kind)
    if (byKind !== 0) return byKind
    return sourceDisplayName(a).localeCompare(sourceDisplayName(b))
  })

  const unknownQuestions: WizardQuestion[] = []
  const documents = orderedShadows.map((shadow, index) => {
    const category = canonicalOrganizationCategory(shadow.classification.kind)
    const sourceName = sourceDisplayName(shadow)
    const canonical_document_path = buildCanonicalDocumentPath(category, sourceName)

    if (category === 'unknown' || shadow.classification.review_required) {
      unknownQuestions.push({
        id: `organize-q-${String(unknownQuestions.length + 1).padStart(3, '0')}`,
        prompt: `What canonical FirmVault document category should ${sourceName} use?`,
        status: 'pending',
        domain: input.domain,
        related_shadow_paths: [shadow.shadow_path],
      })
    }

    return createWizardOrganizedDocumentEntry({
      id: `doc-${String(index + 1).padStart(3, '0')}`,
      domain: input.domain,
      source: { ...shadow.source },
      canonical_document_path,
      shadow_path: shadow.shadow_path,
      classification: { ...shadow.classification },
      review_status: shadow.review_status,
      copy_decision: {
        mode: 'shadow_only',
        status: 'skipped',
        destination_path: canonical_document_path,
        reason: 'copyFiles is false; source file remains read-only at original location',
      },
      legal_boundary: {
        legal_facts_from_organization: 'forbidden',
        legal_facts_from_copied_files: 'forbidden',
        requires_approved_apply: true,
      },
    })
  })

  const warnings = unknownQuestions.length > 0
    ? ['Unknown or ambiguous source files were assigned to documents/unknown/ and require Wizard review.']
    : []

  return {
    schema_version: 1,
    domain: input.domain,
    source_root: input.sourceRoot,
    target_case_root: input.targetCaseRoot,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source_files_read_only: true,
    legal_facts_from_organization: 'forbidden',
    documents,
    questions: unknownQuestions,
    warnings,
  }
}

export async function writeWizardOrganizationPlan(
  input: WriteWizardOrganizationPlanInput,
): Promise<WriteWizardOrganizationPlanResult> {
  const caseRoot = path.resolve(input.caseRoot)
  const outputPath = path.resolve(caseRoot, ORGANIZATION_PLAN_RELATIVE_PATH)
  assertWithinRoot(caseRoot, outputPath)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, yamlStringify(input.plan), 'utf8')

  return {
    path: outputPath,
    relative_path: ORGANIZATION_PLAN_RELATIVE_PATH,
    documents_planned: input.plan.documents.length,
    source_files_copied: input.plan.documents.filter((document) => document.copy_decision.status === 'copied').length,
  }
}

function sourceDisplayName(shadow: WizardShadowRecord): string {
  return path.basename(shadow.source.root_relative_path ?? shadow.source.path)
}

function canonicalOrganizationCategory(kind: string): string {
  const slug = slugifyWizardPathSegment(kind)
  if (!slug || slug === 'unknown') return 'unknown'
  return slug
}

function buildCanonicalDocumentPath(category: string, sourceName: string): string {
  const parsed = path.parse(sourceName)
  const stem = slugifyWizardPathSegment(parsed.name) ?? 'document'
  const ext = parsed.ext && /^[.][a-z0-9]+$/i.test(parsed.ext) ? parsed.ext.toLowerCase() : ''
  return `documents/${category}/${stem}${ext}`
}

function assertSafeOrganizeRelativePath(value: string, label: string): void {
  if (!value || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  if (value.includes('\\')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  if (!value.startsWith('documents/')) {
    throw new Error(`Organized document paths must live under documents/: ${value}`)
  }
}
