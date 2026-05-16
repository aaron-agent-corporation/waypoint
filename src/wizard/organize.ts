import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { stringify as yamlStringify } from 'yaml'

import { assertWithinRoot, safeWizardArtifactPath, slugifyWizardPathSegment } from './paths.ts'
import {
  isSafeWizardRelativePath,
  isWizardDomain,
  type WizardDomain,
  type WizardOrganizedDocumentEntry,
  type WizardOrganizationPlan,
  type WizardQuestion,
  type WizardShadowRecord,
} from './types.ts'

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

export interface WriteWizardOrganizedCasePackageInput {
  caseRoot: string
  plan: WizardOrganizationPlan
  copyFiles?: boolean
}

export interface WriteWizardOrganizedCasePackageResult {
  case_root: string
  directories_created: string[]
  artifacts: string[]
  documents_planned: number
  source_files_copied: number
  documents_copied: string[]
}

const ORGANIZATION_PLAN_RELATIVE_PATH = safeWizardArtifactPath('organization-plan.yaml')
const SOURCE_MANIFEST_RELATIVE_PATH = safeWizardArtifactPath('source-manifest.yaml')
const ORGANIZE_REPORT_RELATIVE_PATH = safeWizardArtifactPath('organize-report.md')
const MISSING_DOCUMENTS_CHECKLIST_RELATIVE_PATH = safeWizardArtifactPath('missing-documents-checklist.md')

export const FIRMVAULT_ORGANIZATION_CATEGORIES = [
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
] as const

export type FirmVaultOrganizationCategory = (typeof FIRMVAULT_ORGANIZATION_CATEGORIES)[number]

interface FirmVaultChecklistItem {
  category: FirmVaultOrganizationCategory
  fact: string
  description: string
}

const FIRMVAULT_ORGANIZATION_CHECKLIST: FirmVaultChecklistItem[] = [
  { category: 'intake', fact: 'client.intake', description: 'Client intake information is complete.' },
  { category: 'contracts', fact: 'client.contracts.fee_agreement', description: 'Client fee agreement has been signed.' },
  { category: 'authorizations', fact: 'client.authorizations.hipaa', description: 'Client HIPAA authorization has been signed.' },
  { category: 'accident', fact: 'accident.police_report', description: 'Accident or police report has been obtained.' },
  { category: 'providers', fact: 'providers.setup', description: 'Medical provider ledger setup is complete.' },
  { category: 'insurance', fact: 'insurance.bi.carrier_identified', description: 'At-fault BI carrier has been identified.' },
  { category: 'insurance', fact: 'insurance.pip.carrier_identified', description: 'PIP carrier has been identified.' },
  { category: 'medical-records', fact: 'records.received', description: 'All requested records have been received.' },
  { category: 'bills', fact: 'records.processing', description: 'Records and bills have been processed.' },
  { category: 'liens', fact: 'liens.early_identification.liens', description: 'Potential liens have been identified or ruled out.' },
  { category: 'demand', fact: 'demand.readiness.materials', description: 'Demand materials have been gathered.' },
  { category: 'negotiation', fact: 'negotiation.initial_offer', description: 'Initial offer has been received.' },
  { category: 'settlement', fact: 'settlement.release', description: 'Release has been executed.' },
  { category: 'settlement', fact: 'settlement.funds', description: 'Settlement funds have been received or cleared.' },
  { category: 'closing', fact: 'settlement.closing.letter.sent', description: 'Final client letter has been sent.' },
  { category: 'closing', fact: 'settlement.closing.case', description: 'Case closure has been documented.' },
]

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

export async function writeWizardOrganizedCasePackage(
  input: WriteWizardOrganizedCasePackageInput,
): Promise<WriteWizardOrganizedCasePackageResult> {
  const caseRoot = path.resolve(input.caseRoot)
  const workingPlan = cloneOrganizationPlan(input.plan)
  const directories = buildOrganizedCaseDirectories(workingPlan)
  const artifacts: string[] = []

  for (const directory of directories) {
    await mkdir(safeCasePackagePath(caseRoot, directory), { recursive: true })
  }

  const documentsCopied = input.copyFiles ? await copyOrganizedDocuments(caseRoot, workingPlan) : []

  artifacts.push(await writeCasePackageArtifact(caseRoot, 'README.md', renderCaseReadme(workingPlan)))

  for (const category of organizationCategories(workingPlan)) {
    artifacts.push(
      await writeCasePackageArtifact(
        caseRoot,
        `documents/${category}/README.md`,
        renderCategoryReadme(category, workingPlan.documents.filter((document) => documentCategory(document) === category)),
      ),
    )
  }

  artifacts.push(
    await writeCasePackageArtifact(caseRoot, SOURCE_MANIFEST_RELATIVE_PATH, yamlStringify(buildSourceManifest(workingPlan))),
  )
  const organizationPlanResult = await writeWizardOrganizationPlan({ caseRoot, plan: workingPlan })
  artifacts.push(organizationPlanResult.relative_path)
  artifacts.push(await writeCasePackageArtifact(caseRoot, ORGANIZE_REPORT_RELATIVE_PATH, renderOrganizeReport(workingPlan)))
  artifacts.push(
    await writeCasePackageArtifact(
      caseRoot,
      MISSING_DOCUMENTS_CHECKLIST_RELATIVE_PATH,
      renderMissingDocumentsChecklist(workingPlan),
    ),
  )

  return {
    case_root: caseRoot,
    directories_created: directories,
    artifacts,
    documents_planned: workingPlan.documents.length,
    source_files_copied: documentsCopied.length,
    documents_copied: documentsCopied,
  }
}

function sourceDisplayName(shadow: WizardShadowRecord): string {
  return path.basename(shadow.source.root_relative_path ?? shadow.source.path)
}

function cloneOrganizationPlan(plan: WizardOrganizationPlan): WizardOrganizationPlan {
  return {
    ...plan,
    documents: plan.documents.map((document) => ({
      ...document,
      source: { ...document.source },
      classification: { ...document.classification },
      copy_decision: { ...document.copy_decision },
      legal_boundary: { ...document.legal_boundary },
    })),
    questions: plan.questions.map((question) => ({
      ...question,
      related_shadow_paths: [...(question.related_shadow_paths ?? [])],
    })),
    warnings: [...plan.warnings],
  }
}

async function copyOrganizedDocuments(caseRoot: string, plan: WizardOrganizationPlan): Promise<string[]> {
  const copied: string[] = []
  const usedDestinations = new Set<string>()

  for (const document of plan.documents) {
    const destinationPath = nextAvailableDestination(document.canonical_document_path, usedDestinations)
    assertSafeOrganizeRelativePath(destinationPath, 'copy destination path')

    const sourceBytes = await readFile(document.source.path)
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
    if (sourceHash !== document.source.sha256) {
      throw new Error(`Source hash mismatch for ${document.source.path}`)
    }

    const outputPath = safeCasePackagePath(caseRoot, destinationPath)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, sourceBytes)

    const copiedBytes = await readFile(outputPath)
    const copiedHash = createHash('sha256').update(copiedBytes).digest('hex')
    if (copiedHash !== sourceHash) {
      throw new Error(`Copied hash mismatch for ${destinationPath}`)
    }

    document.canonical_document_path = destinationPath
    document.copy_decision = {
      mode: 'copy_requested',
      status: 'copied',
      destination_path: destinationPath,
      source_sha256_verified: sourceHash,
    }
    copied.push(destinationPath)
  }

  return copied
}

function nextAvailableDestination(requestedPath: string, usedDestinations: Set<string>): string {
  assertSafeOrganizeRelativePath(requestedPath, 'copy destination path')
  if (!usedDestinations.has(requestedPath)) {
    usedDestinations.add(requestedPath)
    return requestedPath
  }

  const parsed = path.posix.parse(requestedPath)
  let counter = 2
  while (true) {
    const candidate = path.posix.join(parsed.dir, `${parsed.name}-${String(counter).padStart(3, '0')}${parsed.ext}`)
    if (!usedDestinations.has(candidate)) {
      usedDestinations.add(candidate)
      return candidate
    }
    counter += 1
  }
}

function canonicalOrganizationCategory(kind: string): string {
  const slug = slugifyWizardPathSegment(kind)
  if (!slug || slug === 'unknown') return 'unknown'
  if (FIRMVAULT_ORGANIZATION_CATEGORIES.includes(slug as FirmVaultOrganizationCategory)) {
    return slug
  }
  return 'unknown'
}

export function firmVaultOrganizationCategoryForFact(factSlug: string): FirmVaultOrganizationCategory {
  if (factSlug === 'case.setup') return 'intake'
  if (factSlug.startsWith('client.contracts.')) return 'contracts'
  if (factSlug.startsWith('client.authorizations.')) return 'authorizations'
  if (factSlug.startsWith('client.')) return 'intake'
  if (factSlug.startsWith('accident.')) return 'accident'
  if (factSlug.startsWith('insurance.')) return 'insurance'
  if (factSlug.startsWith('providers.')) return 'providers'
  if (factSlug.startsWith('records.')) {
    if (factSlug.includes('authorization')) return 'authorizations'
    if (factSlug.includes('received') || factSlug.includes('chronology')) return 'medical-records'
    if (factSlug.includes('processing')) return 'bills'
    return 'providers'
  }
  if (factSlug.startsWith('liens.')) return 'liens'
  if (factSlug.startsWith('demand.')) return 'demand'
  if (factSlug.startsWith('negotiation.')) return 'negotiation'
  if (factSlug === 'settlement') return 'settlement'
  if (factSlug.startsWith('settlement.closing.')) return 'closing'
  if (factSlug.startsWith('settlement.liens.')) return 'liens'
  if (factSlug.startsWith('settlement.distribution.')) return 'settlement'
  if (factSlug.startsWith('settlement.')) return 'settlement'
  return 'unknown'
}

function buildCanonicalDocumentPath(category: string, sourceName: string): string {
  const parsed = path.parse(sourceName)
  const stem = slugifyWizardPathSegment(parsed.name) ?? 'document'
  const ext = parsed.ext && /^[.][a-z0-9]+$/i.test(parsed.ext) ? parsed.ext.toLowerCase() : ''
  return `documents/${category}/${stem}${ext}`
}

function buildOrganizedCaseDirectories(plan: WizardOrganizationPlan): string[] {
  return ['.waypoint/wizard', ...organizationCategories(plan).map((category) => `documents/${category}`)]
}

function organizationCategories(plan: WizardOrganizationPlan): string[] {
  return Array.from(new Set(plan.documents.map(documentCategory))).sort((a, b) => a.localeCompare(b))
}

function documentCategory(document: WizardOrganizedDocumentEntry): string {
  return document.canonical_document_path.split('/')[1] ?? 'unknown'
}

async function writeCasePackageArtifact(caseRoot: string, relativePath: string, content: string): Promise<string> {
  const outputPath = safeCasePackagePath(caseRoot, relativePath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return relativePath
}

function safeCasePackagePath(caseRoot: string, relativePath: string): string {
  const outputPath = path.resolve(caseRoot, relativePath)
  assertWithinRoot(caseRoot, outputPath)
  return outputPath
}

function buildSourceManifest(plan: WizardOrganizationPlan): Record<string, unknown> {
  return {
    schema_version: 1,
    domain: plan.domain,
    source_root: plan.source_root,
    target_case_root: plan.target_case_root,
    generated_at: plan.generated_at,
    source_files_read_only: true,
    legal_facts_from_organization: 'forbidden',
    files: plan.documents.map((document) => ({
      id: document.id,
      source_path: document.source.path,
      source_root_relative_path: document.source.root_relative_path,
      source_sha256: document.source.sha256,
      source_size_bytes: document.source.size_bytes,
      canonical_document_path: document.canonical_document_path,
      shadow_path: document.shadow_path,
      classification_kind: document.classification.kind,
      review_status: document.review_status,
      copy_status: document.copy_decision.status,
      copied_sha256: document.copy_decision.source_sha256_verified,
    })),
  }
}

function renderCaseReadme(plan: WizardOrganizationPlan): string {
  return [
    '# Waypoint Wizard organized case package',
    '',
    `Domain: ${plan.domain}`,
    `Source root: ${plan.source_root}`,
    `Documents planned: ${plan.documents.length}`,
    '',
    '## Safety boundaries',
    '',
    '- Source files are read-only inputs by default.',
    '- Organization and copied files do not satisfy legal facts.',
    '- Legal state changes require approved Wizard apply through safe FirmVault APIs.',
    '',
    '## Document folders',
    '',
    ...organizationCategories(plan).map((category) => `- documents/${category}/`),
    '',
  ].join('\n')
}

function renderCategoryReadme(category: string, documents: WizardOrganizedDocumentEntry[]): string {
  return [
    `# documents/${category}`,
    '',
    'Planned documents:',
    '',
    ...documents.map((document) => `- ${path.basename(document.source.root_relative_path ?? document.source.path)} → ${document.canonical_document_path}`),
    '',
    'Legal note: folder placement is organizational only and does not satisfy FirmVault legal facts.',
    '',
  ].join('\n')
}

function renderOrganizeReport(plan: WizardOrganizationPlan): string {
  const copied = plan.documents.filter((document) => document.copy_decision.status === 'copied').length
  return [
    '# Waypoint Wizard organize report',
    '',
    `Generated: ${plan.generated_at}`,
    `Documents planned: ${plan.documents.length}`,
    `Source files copied: ${copied}`,
    `Legal facts from organization: ${plan.legal_facts_from_organization}`,
    '',
    '## Warnings',
    '',
    ...(plan.warnings.length > 0 ? plan.warnings.map((warning) => `- ${warning}`) : ['- None']),
    '',
  ].join('\n')
}

function renderMissingDocumentsChecklist(plan: WizardOrganizationPlan): string {
  const lines = [
    '# Missing documents and review checklist',
    '',
    '- [ ] Review unknown files in `documents/unknown/`',
  ]

  for (const question of plan.questions) {
    lines.push(`- [ ] Answer ${question.id}: ${question.prompt}`)
  }

  if (plan.domain === 'firmvault') {
    lines.push('', '## FirmVault fact-derived checklist', '')
    const countsByCategory = countDocumentsByCategory(plan)
    for (const category of FIRMVAULT_ORGANIZATION_CATEGORIES.filter((item) => item !== 'unknown')) {
      const count = countsByCategory.get(category) ?? 0
      const marker = count > 0 ? 'x' : ' '
      const summary = count > 0
        ? `current package includes ${count} document(s)`
        : 'no organized documents yet'
      lines.push(`- [${marker}] ${category} — ${summary}`)

      for (const item of FIRMVAULT_ORGANIZATION_CHECKLIST.filter((entry) => entry.category === category)) {
        lines.push(`  - \`${item.fact}\`: ${item.description}`)
      }
    }
  }

  lines.push('', 'Legal note: completing this checklist does not apply legal facts; use approved Wizard apply.')
  return `${lines.join('\n')}\n`
}

function countDocumentsByCategory(plan: WizardOrganizationPlan): Map<string, number> {
  const counts = new Map<string, number>()
  for (const document of plan.documents) {
    const category = documentCategory(document)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
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
