import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

import { assertWithinRoot, safeShadowRelativePath, slugifyWizardPathSegment } from './paths'
import { isWizardDomain, type WizardDomain, type WizardScanResult, type WizardShadowRecord } from './types'

export interface CreateWizardShadowsInput {
  scan: WizardScanResult
  targetRoot: string
  domain: WizardDomain
}

export interface CreateWizardShadowsResult {
  target_root: string
  shadows: WizardShadowRecord[]
}

const FIRMVAULT_CATEGORY_KEYWORDS: Record<string, { keywords: string[]; rationale: string }> = {
  contracts: {
    keywords: ['fee agreement', 'engagement', 'retainer', 'contract', 'agreement'],
    rationale: 'Filename contains contract-related keywords',
  },
  authorizations: {
    keywords: ['hipaa', 'authorization', 'consent'],
    rationale: 'Filename contains authorization-related keywords',
  },
  accident: {
    keywords: ['police report', 'accident', 'crash', 'incident'],
    rationale: 'Filename contains accident-related keywords',
  },
  bills: {
    keywords: ['bill', 'invoice', 'statement'],
    rationale: 'Filename contains billing-related keywords',
  },
  medical: {
    keywords: ['medical', 'records', 'treatment', 'doctor', 'clinic', 'hospital'],
    rationale: 'Filename contains medical-related keywords',
  },
  settlement: {
    keywords: ['settlement', 'check', 'payment', 'disbursement', 'release'],
    rationale: 'Filename contains settlement-related keywords',
  },
  correspondence: {
    keywords: ['letter', 'email', 'memo', 'correspondence', 'notice'],
    rationale: 'Filename contains correspondence-related keywords',
  },
}

export function classifyFirmVaultSourceFile(name: string): { kind: string; confidence: 'low' | 'medium' | 'high'; rationale: string } {
  const lower = name.toLowerCase()
  for (const [category, info] of Object.entries(FIRMVAULT_CATEGORY_KEYWORDS)) {
    if (info.keywords.some((kw) => lower.includes(kw))) {
      return { kind: category, confidence: 'high', rationale: info.rationale }
    }
  }
  return { kind: 'unknown', confidence: 'low', rationale: 'No matching classification keywords found' }
}

function mediaHintToPiiStrategy(mediaHint: string): string {
  if (mediaHint.startsWith('image/')) return 'redact-faces'
  if (mediaHint === 'text/plain' || mediaHint === 'text/markdown') return 'hash-identifiers'
  return 'full-redact'
}

export async function createWizardShadows(input: CreateWizardShadowsInput): Promise<CreateWizardShadowsResult> {
  const { scan, targetRoot, domain } = input

  if (!isWizardDomain(domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(domain)}`)
  }

  // Ensure target root exists
  await mkdir(targetRoot, {recursive: true})

  const shadows: WizardShadowRecord[] = []

  for (const file of scan.files) {
    const classification = classifyFirmVaultSourceFile(file.root_relative_path ?? file.path)

    // Determine category: prefer directory name, fall back to classifier
    let category = classification.kind
    if (file.root_relative_path) {
      const dir = path.dirname(file.root_relative_path)
      if (dir && dir !== '.') {
        category = dir.split('/')[0]
      }
    }

    const slugifiedCategory = slugifyWizardPathSegment(category) || 'unknown'
    const baseName = path.basename(file.root_relative_path ?? file.path)

    const relativeShadowPath = safeShadowRelativePath(domain, slugifiedCategory, baseName)
    const absoluteShadowPath = path.join(targetRoot, relativeShadowPath)

    // Ensure category directory exists
    await mkdir(path.dirname(absoluteShadowPath), { recursive: true })

    const piiStrategy = mediaHintToPiiStrategy(file.media_hint ?? 'application/octet-stream')

    const frontmatter = {
      schema_version: 1,
      shadow_type: 'document' as const,
      domain,
      source: {
        path: file.path,
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        media_type: file.media_type,
        discovered_at: file.discovered_at,
      },
      pii: {
        masked: true,
        strategy: piiStrategy,
      },
      classification: {
        kind: classification.kind,
        confidence: classification.confidence,
        rationale: classification.rationale,
      },
      waypoint: {
        canonical_path: relativeShadowPath,
      },
      review: {
        status: 'pending' as const,
      },
    } satisfies import('./types').WizardShadowDocumentFrontmatter

    const body = `# Shadow for ${baseName}\n\nThis is a Waypoint Wizard shadow for the source file recorded in frontmatter.\n`

    // Import serializeWizardShadowMarkdown dynamically to avoid circular dep
    const { serializeWizardShadowMarkdown } = await import('./shadow-frontmatter')
    const markdown = serializeWizardShadowMarkdown({ frontmatter, body })

    await writeFile(absoluteShadowPath, markdown, 'utf-8')

    shadows.push({
      id: `${domain}-${scan.files.indexOf(file)}`,
      domain,
      shadow_path: absoluteShadowPath,
      source: {
        path: file.path,
        root_relative_path: file.root_relative_path,
        sha256: file.sha256,
        size_bytes: file.size_bytes,
        media_type: file.media_type,
        discovered_at: file.discovered_at,
      },
      classification: {
        kind: classification.kind,
        confidence: classification.confidence,
        rationale: classification.rationale,
        review_required: classification.confidence !== 'high',
      },
      review_status: 'pending',
    })
  }

  return {
    target_root: targetRoot,
    shadows,
  }
}