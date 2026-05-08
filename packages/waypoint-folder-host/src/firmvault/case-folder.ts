import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export const FIRMVAULT_REQUIRED_CASE_PATHS = [
  'AGENTS.md',
  'Dashboard.md',
  'client/',
  'client/intake.md',
  'client/contracts.md',
  'client/authorizations.md',
  'client/contactability.md',
  'client/check-ins.md',
  'accident/',
  'accident/accident.md',
  'accident/police-report.md',
  'accident/liability.md',
  'contacts/',
  'insurance/',
  'medical-providers/',
  'liens/',
  'demand/',
  'negotiation/',
  'settlement/',
  'litigation/',
  'documents/',
  'activity/',
  'activity/index.md',
  'workflow-log/',
  'workflow-log/index.md',
] as const

export const FIRMVAULT_STARTER_CASE_PATHS = FIRMVAULT_REQUIRED_CASE_PATHS

const RESERVED_ROOT_MARKDOWN_FILES = new Set(['agents.md', 'dashboard.md', 'readme.md'])

export interface FirmVaultCaseFolderInspection {
  readonly root: string
  readonly looksLikeFirmVaultCase: boolean
  readonly caseSlug: string | null
  readonly caseIndexCandidates: readonly string[]
  readonly presentRequiredPaths: readonly string[]
  readonly missingRequiredPaths: readonly string[]
  readonly warnings: readonly string[]
}

export async function inspectFirmVaultCaseFolder(root: string): Promise<FirmVaultCaseFolderInspection> {
  const [presentRequiredPaths, caseIndexCandidates] = await Promise.all([
    listPresentRequiredPaths(root),
    listCaseIndexCandidates(root),
  ])
  const missingRequiredPaths = FIRMVAULT_REQUIRED_CASE_PATHS.filter((relativePath) => !presentRequiredPaths.includes(relativePath))
  const warnings: string[] = []
  let caseSlug: string | null = null

  if (caseIndexCandidates.length === 0) {
    warnings.push('No plausible case index markdown file found in the folder root.')
  } else if (caseIndexCandidates.length === 1) {
    caseSlug = caseIndexCandidates[0].slice(0, -extname(caseIndexCandidates[0]).length)
  } else {
    warnings.push(`Multiple plausible case index markdown files found: ${caseIndexCandidates.join(', ')}.`)
  }

  return {
    root,
    looksLikeFirmVaultCase: missingRequiredPaths.length === 0 && caseIndexCandidates.length <= 1,
    caseSlug,
    caseIndexCandidates,
    presentRequiredPaths,
    missingRequiredPaths,
    warnings,
  }
}

async function listPresentRequiredPaths(root: string): Promise<string[]> {
  const present: string[] = []
  for (const relativePath of FIRMVAULT_REQUIRED_CASE_PATHS) {
    if (await requiredPathExists(root, relativePath)) {
      present.push(relativePath)
    }
  }
  return present
}

async function requiredPathExists(root: string, relativePath: string): Promise<boolean> {
  try {
    const entry = await stat(join(root, relativePath))
    return relativePath.endsWith('/') ? entry.isDirectory() : entry.isFile()
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

async function listCaseIndexCandidates(root: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }

  const candidates: string[] = []
  for (const entry of entries) {
    const lower = entry.toLowerCase()
    if (!lower.endsWith('.md')) continue
    if (RESERVED_ROOT_MARKDOWN_FILES.has(lower)) continue
    if (lower.startsWith('_')) continue

    const fullPath = join(root, entry)
    const entryStat = await stat(fullPath)
    if (!entryStat.isFile()) continue
    candidates.push(basename(entry))
  }
  return candidates.sort((a, b) => a.localeCompare(b))
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
