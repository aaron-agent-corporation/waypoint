import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { parse as yamlParse } from 'yaml'

import { FIRMVAULT_FACT_DEFINITIONS, getFirmVaultFactDefinition } from './facts.ts'
import {
  initFirmVaultCaseState,
  readFirmVaultLandmarkProjection,
  setFirmVaultCaseFact,
  type FirmVaultCaseType,
  type FirmVaultLandmarkCounts,
} from './state.ts'

export type FirmVaultAdoptionConfidence = 'high' | 'medium' | 'low' | 'needs_human_confirmation'

export interface FirmVaultLegacyCaseInspection {
  readonly schema_version: 1
  readonly mutates_state: false
  readonly case_root: string
  readonly case_slug: string
  readonly legacy_state: {
    readonly present: boolean
    readonly current_phase: string | null
    readonly landmark_count: number
  }
  readonly waypoint_state: { readonly present: boolean }
  readonly source_counts: {
    readonly total_files: number
    readonly by_extension: Record<string, number>
    readonly by_top_level: Record<string, number>
  }
  readonly document_frontmatter: {
    readonly categories: Record<string, number>
    readonly keys: Record<string, number>
  }
  readonly examples: readonly string[]
  readonly warnings: readonly string[]
}

export interface FirmVaultAdoptionEvidenceCandidate {
  readonly path: string
  readonly reason: string
}

export interface FirmVaultAdoptionProposal {
  readonly fact: string
  readonly suggested_status: string
  readonly confidence: FirmVaultAdoptionConfidence
  readonly evidence_candidates: readonly FirmVaultAdoptionEvidenceCandidate[]
  readonly reason: string
  readonly safe_to_apply_automatically: boolean
}

export interface FirmVaultCaseAdoptionPreview {
  readonly schema_version: 1
  readonly mutates_state: false
  readonly case_slug: string
  readonly legacy_phase: string | null
  readonly waypoint_state_present: boolean
  readonly source_summary: FirmVaultLegacyCaseInspection['source_counts']
  readonly proposed_facts: readonly FirmVaultAdoptionProposal[]
  readonly blocked_or_needs_confirmation: readonly FirmVaultAdoptionProposal[]
  readonly warnings: readonly string[]
}

export interface AdoptFirmVaultLegacyCaseOptions {
  readonly caseType: FirmVaultCaseType
  readonly applySafe?: boolean
}

export interface AdoptFirmVaultLegacyCaseResult {
  readonly schema_version: 1
  readonly mutates_state: true
  readonly case_slug: string
  readonly applied_facts: readonly { readonly fact: string; readonly status: string; readonly evidence: readonly string[] }[]
  readonly skipped_facts: readonly FirmVaultAdoptionProposal[]
  readonly landmarks_before: FirmVaultLandmarkCounts
  readonly landmarks_after: FirmVaultLandmarkCounts
  readonly warnings: readonly string[]
}

const SKIP_DIRS = new Set(['.waypoint', '.obsidian', '.git', 'node_modules'])

export async function inspectFirmVaultLegacyCase(caseRoot: string): Promise<FirmVaultLegacyCaseInspection> {
  const files: string[] = []
  await walkCase(caseRoot, caseRoot, files)

  const byExtension: Record<string, number> = {}
  const byTopLevel: Record<string, number> = {}
  const categories: Record<string, number> = {}
  const keys: Record<string, number> = {}
  const warnings: string[] = []

  for (const path of files) {
    const extension = extname(path).toLowerCase() || '[no_extension]'
    byExtension[extension] = (byExtension[extension] ?? 0) + 1
    const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : path
    byTopLevel[top] = (byTopLevel[top] ?? 0) + 1

    if (extension === '.md') {
      const frontmatter = await readMarkdownFrontmatter(join(caseRoot, path))
      for (const key of Object.keys(frontmatter)) keys[key] = (keys[key] ?? 0) + 1
      const category = stringValue(frontmatter.document_category ?? frontmatter.category)
      if (category) categories[category] = (categories[category] ?? 0) + 1
    }
  }

  const legacy = await readLegacyState(caseRoot)
  const waypointPresent = files.some((path) => path.startsWith('.waypoint/firmvault/'))
  if (!legacy.present) warnings.push('legacy state.yaml not found')
  if (files.length === 0) warnings.push('no source documents found')

  return {
    schema_version: 1,
    mutates_state: false,
    case_root: caseRoot,
    case_slug: slugFromCaseRoot(caseRoot),
    legacy_state: legacy,
    waypoint_state: { present: waypointPresent },
    source_counts: {
      total_files: files.length,
      by_extension: byExtension,
      by_top_level: byTopLevel,
    },
    document_frontmatter: { categories, keys },
    examples: files.slice(0, 20),
    warnings,
  }
}

export async function previewFirmVaultCaseAdoption(caseRoot: string): Promise<FirmVaultCaseAdoptionPreview> {
  const inspection = await inspectFirmVaultLegacyCase(caseRoot)
  const allFiles = await listCaseFiles(caseRoot)
  const proposals: FirmVaultAdoptionProposal[] = []
  const blocked: FirmVaultAdoptionProposal[] = []

  const addProposal = (proposal: FirmVaultAdoptionProposal): void => {
    if (proposals.some((existing) => existing.fact === proposal.fact)) return
    proposals.push(proposal)
  }
  const addBlocked = (proposal: FirmVaultAdoptionProposal): void => {
    if (blocked.some((existing) => existing.fact === proposal.fact)) return
    blocked.push(proposal)
  }

  const dashboard = firstMatching(allFiles, ['dashboard.md']) ?? firstMatching(allFiles, ['.md']) ?? firstMatching(allFiles, ['state.yaml'])
  if (dashboard) addProposal(proposal('case.setup', 'complete', 'high', dashboard, 'case folder contains legacy case setup artifacts'))

  const intake = firstMatching(allFiles, ['intake', 'client'])
  if (intake) addProposal(proposal('client.intake', 'complete', 'medium', intake, 'client/intake source artifact found'))
  else addBlocked(blockedProposal('client.intake', 'complete', 'needs_human_confirmation', 'no specific client intake evidence found'))

  const fee = firstMatching(allFiles, ['fee', 'contract', 'retainer'])
  if (fee) addProposal(proposal('client.contracts.fee_agreement', 'signed', 'medium', fee, 'fee agreement or contract artifact found'))
  else addBlocked(blockedProposal('client.contracts.fee_agreement', 'signed', 'needs_human_confirmation', 'no signed fee agreement evidence found'))

  const hipaa = firstMatching(allFiles, ['hipaa', 'authorization', 'medical-auth'])
  if (hipaa) addProposal(proposal('client.authorizations.hipaa', 'signed', 'medium', hipaa, 'HIPAA/medical authorization artifact found'))

  const police = firstMatching(allFiles, ['police-reports', 'police_report', 'police-report', 'crash-report'])
  if (police) addProposal(proposal('accident.police_report', 'received', 'high', police, 'police report artifact found'))

  const claim = firstMatching(allFiles, ['claims/', 'claim', 'insurance'])
  if (claim) addProposal(proposal('insurance.bi.carrier_identified', 'identified', 'medium', claim, 'claim or insurance artifact found'))

  const medical = firstMatching(allFiles, ['documents/medical', '/medical/', 'provider', 'records'])
  if (medical) {
    addProposal(proposal('providers.setup', 'complete', 'medium', medical, 'medical/provider artifact found'))
    addProposal(proposal('records.processing', 'processed', 'medium', medical, 'medical records/bills artifact found'))
    addProposal(proposal('records.received', 'all_received', 'medium', medical, 'medical records source artifact found'))
  }

  const demandReadiness = firstMatching(allFiles, ['demand/readiness', 'demand-readiness'])
  if (demandReadiness) addProposal(proposal('demand.readiness.materials', 'gathered', 'medium', demandReadiness, 'demand readiness artifact found'))
  if (inspection.legacy_state.current_phase === 'phase_3_demand') {
    addBlocked(blockedProposal('demand.send', 'sent', 'needs_human_confirmation', 'legacy phase indicates demand work, but no sent demand evidence was confirmed'))
  }

  const litigation = firstMatching(allFiles, ['litigation', 'court-filings', 'legal-filings'])
  if (litigation) addBlocked(blockedProposal('firmvault.litigation.review', 'reviewed', 'needs_human_confirmation', 'litigation artifacts require human mapping to the current pre-suit state model'))

  if (inspection.legacy_state.current_phase === 'phase_8_closed') {
    addBlocked(blockedProposal('settlement.closing.case', 'closed', 'needs_human_confirmation', 'legacy state marks the case closed; closeout evidence must be confirmed before applying'))
  }

  return {
    schema_version: 1,
    mutates_state: false,
    case_slug: inspection.case_slug,
    legacy_phase: inspection.legacy_state.current_phase,
    waypoint_state_present: inspection.waypoint_state.present,
    source_summary: inspection.source_counts,
    proposed_facts: proposals,
    blocked_or_needs_confirmation: blocked,
    warnings: inspection.warnings,
  }
}

export async function adoptFirmVaultLegacyCase(
  caseRoot: string,
  options: AdoptFirmVaultLegacyCaseOptions,
): Promise<AdoptFirmVaultLegacyCaseResult> {
  const preview = await previewFirmVaultCaseAdoption(caseRoot)
  const init = await initFirmVaultCaseState(caseRoot, { caseType: options.caseType, caseSlug: preview.case_slug })
  const before = countProjection(init.projection)
  const applied: { fact: string; status: string; evidence: string[] }[] = []
  const skipped: FirmVaultAdoptionProposal[] = []

  if (options.applySafe) {
    for (const item of preview.proposed_facts) {
      if (!item.safe_to_apply_automatically) {
        skipped.push(item)
        continue
      }
      const definition = getFirmVaultFactDefinition(item.fact)
      if (!definition || !definition.allowedStatuses.includes(item.suggested_status)) {
        skipped.push(item)
        continue
      }
      const evidence = item.evidence_candidates.slice(0, 3).map((candidate) => ({ path: candidate.path }))
      await setFirmVaultCaseFact(caseRoot, {
        fact: item.fact,
        status: item.suggested_status,
        evidence,
        note: `Adopted from legacy case folder: ${item.reason}`,
      })
      applied.push({ fact: item.fact, status: item.suggested_status, evidence: evidence.map((entry) => entry.path) })
    }
  } else {
    skipped.push(...preview.proposed_facts)
  }
  skipped.push(...preview.blocked_or_needs_confirmation)

  const after = countProjection(await readFirmVaultLandmarkProjection(caseRoot))
  return {
    schema_version: 1,
    mutates_state: true,
    case_slug: preview.case_slug,
    applied_facts: applied,
    skipped_facts: skipped,
    landmarks_before: before,
    landmarks_after: after,
    warnings: preview.warnings,
  }
}

async function walkCase(root: string, dir: string, out: string[]): Promise<void> {
  let entries: readonly { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkCase(root, absolute, out)
      continue
    }
    if (!entry.isFile()) continue
    out.push(toPosix(relative(root, absolute)))
  }
}

async function listCaseFiles(root: string): Promise<string[]> {
  const files: string[] = []
  await walkCase(root, root, files)
  return files.sort()
}

async function readLegacyState(root: string): Promise<FirmVaultLegacyCaseInspection['legacy_state']> {
  const path = join(root, 'state.yaml')
  try {
    await stat(path)
    const parsed = yamlParse(await readFile(path, 'utf8')) as Record<string, unknown> | null
    const landmarks = isRecord(parsed?.landmarks) ? Object.values(parsed.landmarks).filter(Boolean).length : 0
    return {
      present: true,
      current_phase: typeof parsed?.current_phase === 'string' ? parsed.current_phase : null,
      landmark_count: landmarks,
    }
  } catch {
    return { present: false, current_phase: null, landmark_count: 0 }
  }
}

async function readMarkdownFrontmatter(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, 'utf8')
    if (!text.startsWith('---\n')) return {}
    const end = text.indexOf('\n---', 4)
    if (end === -1) return {}
    const parsed = yamlParse(text.slice(4, end))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function proposal(
  fact: string,
  status: string,
  confidence: Exclude<FirmVaultAdoptionConfidence, 'needs_human_confirmation'>,
  evidencePath: string,
  reason: string,
): FirmVaultAdoptionProposal {
  const definition = FIRMVAULT_FACT_DEFINITIONS.find((item) => item.fact === fact)
  return {
    fact,
    suggested_status: status,
    confidence,
    evidence_candidates: [{ path: evidencePath, reason }],
    reason,
    safe_to_apply_automatically: Boolean(definition && definition.allowedStatuses.includes(status)),
  }
}

function blockedProposal(fact: string, status: string, confidence: FirmVaultAdoptionConfidence, reason: string): FirmVaultAdoptionProposal {
  return {
    fact,
    suggested_status: status,
    confidence,
    evidence_candidates: [],
    reason,
    safe_to_apply_automatically: false,
  }
}

function firstMatching(files: readonly string[], needles: readonly string[]): string | null {
  const lowered = needles.map((needle) => needle.toLowerCase())
  return files.find((file) => {
    const candidate = file.toLowerCase()
    return lowered.some((needle) => candidate.includes(needle))
  }) ?? null
}

function countProjection(projection: Awaited<ReturnType<typeof readFirmVaultLandmarkProjection>>): FirmVaultLandmarkCounts {
  const values = Object.values(projection.landmarks)
  return { satisfied: values.filter((landmark) => landmark.satisfied).length, total: values.length }
}

function slugFromCaseRoot(root: string): string {
  return basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'firmvault-case'
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
