import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

import { classifyWizardSourceFile } from './classifier.ts'
import { safeShadowRelativePath, slugifyWizardPathSegment } from './paths.ts'
import { isWizardDomain, type WizardDomain, type WizardScanResult, type WizardShadowRecord } from './types.ts'

export interface CreateWizardShadowsInput {
  scan: WizardScanResult
  targetRoot: string
  domain: WizardDomain
}

export interface CreateWizardShadowsResult {
  target_root: string
  shadows: WizardShadowRecord[]
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
    const classification = classifyWizardSourceFile(file)

    const category = classification.kind

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
        raw_text_included: false,
        source_content_policy: 'not_copied' as const,
        notes: ['Source contents are not copied into this shadow by default.'],
      },
      extraction: {
        status: 'stub' as const,
        method: 'deterministic-stub-v1',
        raw_text_included: false,
        notes: ['OCR/extraction is intentionally deferred; this shadow contains a deterministic safe stub.'],
      },
      classification: {
        kind: classification.kind,
        confidence: classification.confidence,
        rationale: classification.rationale,
      },
      runner: {
        canonical_path: relativeShadowPath,
      },
      review: {
        status: 'pending' as const,
      },
    } satisfies import('./types').WizardShadowDocumentFrontmatter

    const body = `# Shadow for ${baseName}\n\nThis is a Waypoint Wizard shadow for the source file recorded in frontmatter.\n\nSource contents were not copied into this shadow. Extraction is currently a safe deterministic stub; legal facts remain unsatisfied until explicitly reviewed and applied through safe state APIs.\n`

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