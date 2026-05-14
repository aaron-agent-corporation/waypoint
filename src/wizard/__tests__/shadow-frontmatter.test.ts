import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  parseWizardShadowMarkdown,
  serializeWizardShadowMarkdown,
  type WizardShadowDocumentFrontmatter,
} from '../../index'

const frontmatter: WizardShadowDocumentFrontmatter = {
  schema_version: 1,
  shadow_type: 'document',
  domain: 'firmvault',
  source: {
    path: '/tmp/messy-case/Scan 001.pdf',
    root_relative_path: 'Scan 001.pdf',
    sha256: 'a'.repeat(64),
    size_bytes: 482991,
    media_type: 'application/pdf',
    discovered_at: '2026-05-14T00:00:00.000Z',
  },
  pii: {
    masked: true,
    strategy: 'local-redaction-v1',
    notes: ['No OCR performed in this slice'],
  },
  classification: {
    kind: 'intake',
    confidence: 'medium',
    rationale: 'filename suggests an intake packet',
    review_required: true,
  },
  waypoint: {
    canonical_path: '.waypoint/shadows/firmvault/intake/scan-001.md',
    proposed_facts: ['client.intake'],
  },
  review: {
    status: 'pending',
    questions: ['intake-signed-or-draft'],
  },
}

describe('Waypoint Wizard shadow frontmatter serialization', () => {
  it('serializes auditable Wizard frontmatter with markdown body', () => {
    const markdown = serializeWizardShadowMarkdown({
      frontmatter,
      body: '# Client Intake Shadow\n\nMasked or summarized extracted content goes here.\n',
    })

    expect(markdown.startsWith('---\n')).toBe(true)
    expect(markdown).toContain('\n---\n# Client Intake Shadow')

    const rawFrontmatter = markdown.slice(4, markdown.indexOf('\n---\n', 4))
    const parsed = parseYaml(rawFrontmatter)

    expect(parsed).toMatchObject({
      schema_version: 1,
      shadow_type: 'document',
      domain: 'firmvault',
      source: {
        path: '/tmp/messy-case/Scan 001.pdf',
        sha256: 'a'.repeat(64),
        size_bytes: 482991,
        media_type: 'application/pdf',
      },
      pii: {
        masked: true,
        strategy: 'local-redaction-v1',
      },
      classification: {
        kind: 'intake',
        confidence: 'medium',
      },
      waypoint: {
        canonical_path: '.waypoint/shadows/firmvault/intake/scan-001.md',
        proposed_facts: ['client.intake'],
      },
      review: {
        status: 'pending',
        questions: ['intake-signed-or-draft'],
      },
    })
  })

  it('parses Wizard shadow markdown back into frontmatter and body', () => {
    const markdown = serializeWizardShadowMarkdown({
      frontmatter,
      body: '# Client Intake Shadow\n\nMasked body.\n',
    })

    const parsed = parseWizardShadowMarkdown(markdown)

    expect(parsed.frontmatter).toEqual(frontmatter)
    expect(parsed.body).toBe('# Client Intake Shadow\n\nMasked body.\n')
  })

  it('rejects markdown without Wizard frontmatter delimiters', () => {
    expect(() => parseWizardShadowMarkdown('# Missing frontmatter')).toThrow(/Wizard frontmatter/)
  })
})
