import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createWizardShadows } from '../shadows'
import { parseWizardShadowMarkdown } from '../shadow-frontmatter'
import { scanWizardSource } from '../scan'

describe('createWizardShadows', () => {
  it('writes deterministic markdown shadows from scanned source files', async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), 'wizard-shadow-'))
    await mkdir(path.join(sourceRoot, 'Medical'), { recursive: true })
    await mkdir(path.join(sourceRoot, 'Photos'), { recursive: true })
    await mkdir(path.join(sourceRoot, 'unknown-folder'), { recursive: true })

    await writeFile(path.join(sourceRoot, 'Intake Docs.pdf.txt'), 'intake packet contents')
    await writeFile(
      path.join(sourceRoot, 'Medical', 'Dr Smith Records.pdf.txt'),
      'medical records contents',
    )
    await writeFile(path.join(sourceRoot, 'Photos', 'image.jpg.txt'), 'fake image bytes')
    await writeFile(
      path.join(sourceRoot, 'unknown-folder', 'mystery.file'),
      'unknown classification',
    )

    const scan = await scanWizardSource({ sourceRoot, domain: 'firmvault' })
    const caseRoot = await mkdtemp(path.join(tmpdir(), 'wizard-case-'))

    const result = await createWizardShadows({
      scan,
      targetRoot: caseRoot,
      domain: 'firmvault',
    })

    expect(result.shadows.length).toBe(4)
    expect(result.target_root).toBe(caseRoot)

    for (const shadow of result.shadows) {
      expect(shadow.shadow_path).toBeTruthy()
      expect(shadow.shadow_path).toContain(caseRoot)
      expect(shadow.shadow_path).toMatch(/\.md$/)

      const content = await readFile(shadow.shadow_path, 'utf-8')
      expect(content.length).toBeGreaterThan(0)

      const parsed = parseWizardShadowMarkdown(content)
      expect(parsed.frontmatter.schema_version).toBe(1)
      expect(parsed.frontmatter.shadow_type).toBe('document')
      expect(parsed.frontmatter.domain).toBe('firmvault')
      expect(parsed.frontmatter.source.path).toBe(shadow.source.path)
      expect(parsed.frontmatter.source.sha256).toBe(shadow.source.sha256)
      expect(parsed.frontmatter.source.size_bytes).toBe(shadow.source.size_bytes)
      expect(parsed.frontmatter.pii.masked).toBe(true)
      expect(parsed.frontmatter.pii.strategy).toBeTruthy()
      expect(parsed.frontmatter.pii.raw_text_included).toBe(false)
      expect(parsed.frontmatter.pii.source_content_policy).toBe('not_copied')
      expect(parsed.frontmatter.pii.notes).toEqual(
        expect.arrayContaining(['Source contents are not copied into this shadow by default.']),
      )
      expect(parsed.frontmatter.extraction).toMatchObject({
        status: 'stub',
        method: 'deterministic-stub-v1',
        raw_text_included: false,
      })
      expect(parsed.frontmatter.classification.kind).toBe(shadow.classification.kind)
      expect(parsed.frontmatter.classification.confidence).toBe(shadow.classification.confidence)
      expect(parsed.frontmatter.review.status).toBe('pending')
      expect(parsed.body).toContain('Shadow for')
    }

    // relative shadow paths are under the shadow namespace
    const relativePaths = result.shadows.map((s) =>
      path.relative(caseRoot, s.shadow_path),
    )
    for (const relPath of relativePaths) {
      expect(relPath).toContain('.waypoint/shadows/firmvault/')
      expect(relPath).toMatch(/\.md$/)
    }

    // source files remain unchanged
    const intakeContent = await readFile(
      path.join(sourceRoot, 'Intake Docs.pdf.txt'),
      'utf-8',
    )
    expect(intakeContent).toBe('intake packet contents')

    // unknown classification files go under unknown/
    const unknownShadow = result.shadows.find((s) =>
      s.source.root_relative_path?.includes('unknown-folder'),
    )
    expect(unknownShadow).toBeTruthy()
    expect(unknownShadow!.shadow_path).toContain('unknown-folder/')
  })

  it('generates deterministic shadow paths using slugified category and filename', async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), 'wizard-shadow-slug-'))
    await mkdir(sourceRoot, { recursive: true })

    await writeFile(path.join(sourceRoot, 'Fee Agreement.pdf'), 'fee agreement')

    const scan = await scanWizardSource({ sourceRoot, domain: 'firmvault' })
    const caseRoot = await mkdtemp(path.join(tmpdir(), 'wizard-case-slug-'))

    const result = await createWizardShadows({
      scan,
      targetRoot: caseRoot,
      domain: 'firmvault',
    })

    expect(result.shadows.length).toBe(1)
    const shadow = result.shadows[0]

    // category from classifier: contracts/  filename slugified: fee-agreement
    expect(shadow.shadow_path).toContain('contracts/')
    expect(shadow.shadow_path).toMatch(/fee-agreement\.md$/)
  })

  it('does not write outside the target case root', async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), 'wizard-shadow-safe-'))
    await mkdir(sourceRoot, { recursive: true })

    await writeFile(path.join(sourceRoot, 'test.txt'), 'safe test')

    const scan = await scanWizardSource({ sourceRoot, domain: 'firmvault' })
    const caseRoot = await mkdtemp(path.join(tmpdir(), 'wizard-case-safe-'))

    const result = await createWizardShadows({
      scan,
      targetRoot: caseRoot,
      domain: 'firmvault',
    })

    for (const shadow of result.shadows) {
      const resolved = path.resolve(shadow.shadow_path)
      expect(resolved).toContain(path.resolve(caseRoot))
    }
  })

  it('rejects an unsupported domain', async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), 'wizard-shadow-bad-'))
    await writeFile(path.join(sourceRoot, 'test.txt'), 'test')

    const scan = await scanWizardSource({ sourceRoot, domain: 'firmvault' })
    const caseRoot = await mkdtemp(path.join(tmpdir(), 'wizard-case-bad-'))

    await expect(
      createWizardShadows({ scan, targetRoot: caseRoot, domain: 'bogus' as any }),
    ).rejects.toThrow(/Unsupported Wizard domain/)
  })
})