import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertWithinRoot,
  safeShadowRelativePath,
  safeWizardArtifactPath,
  slugifyWizardPathSegment,
} from '../../index'

describe('Waypoint Wizard path safety helpers', () => {
  it('allows absolute source paths to be checked against a source root', () => {
    const sourceRoot = path.resolve('/tmp/messy-case')
    const sourceFile = path.join(sourceRoot, 'Medical', 'Dr Smith Records.pdf')

    expect(() => assertWithinRoot(sourceRoot, sourceFile)).not.toThrow()
  })

  it('rejects source or target paths that escape their root', () => {
    const sourceRoot = path.resolve('/tmp/messy-case')
    const escaped = path.resolve(sourceRoot, '..', 'other-case', 'file.pdf')

    expect(() => assertWithinRoot(sourceRoot, escaped)).toThrow(/outside root/)
  })

  it('builds shadow output paths under the Wizard shadow namespace', () => {
    expect(safeShadowRelativePath('firmvault', 'Medical Records', 'Dr Smith Records.pdf')).toBe(
      '.waypoint/shadows/firmvault/medical-records/dr-smith-records.md',
    )
  })

  it('builds Wizard artifact paths under the Wizard artifact namespace', () => {
    expect(safeWizardArtifactPath('Adoption Plan.yaml')).toBe('.waypoint/wizard/adoption-plan.yaml')
  })

  it('rejects traversal, backslash escapes, and empty path segments', () => {
    expect(() => safeShadowRelativePath('firmvault', '../escape', 'file.pdf')).toThrow(/Unsafe Wizard path segment/)
    expect(() => safeShadowRelativePath('firmvault', 'intake', '..\\escape.pdf')).toThrow(
      /Unsafe Wizard path segment/,
    )
    expect(() => safeShadowRelativePath('firmvault', '', 'file.pdf')).toThrow(/Unsafe Wizard path segment/)
    expect(() => safeWizardArtifactPath('../scan.json')).toThrow(/Unsafe Wizard path segment/)
    expect(() => safeWizardArtifactPath('')).toThrow(/Unsafe Wizard path segment/)
  })

  it('slugifies readable path segments without allowing empty names', () => {
    expect(slugifyWizardPathSegment(' Intake Docs 2026.pdf ')).toBe('intake-docs-2026-pdf')
    expect(slugifyWizardPathSegment('!!!')).toBe(null)
  })
})
