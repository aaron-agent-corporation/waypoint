import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  createWizardSourcePointer,
  isSafeWizardRelativePath,
  isWizardDomain,
  type WizardAdoptionPlan,
  type WizardAnswer,
  type WizardClassification,
  type WizardQuestion,
  type WizardShadowDocumentFrontmatter,
  type WizardSourceFile,
} from '../../index'

describe('Waypoint Wizard core types', () => {
  it('recognizes supported Wizard domains and rejects unsafe values', () => {
    expect(isWizardDomain('firmvault')).toBe(true)
    expect(isWizardDomain('bad domain')).toBe(false)
    expect(isWizardDomain('')).toBe(false)
    expect(isWizardDomain(undefined)).toBe(false)
  })

  it('guards Wizard-owned relative paths', () => {
    expect(isSafeWizardRelativePath('.waypoint/shadows/firmvault/intake/client-intake.md')).toBe(true)
    expect(isSafeWizardRelativePath('.waypoint/wizard/adoption-plan.yaml')).toBe(true)
    expect(isSafeWizardRelativePath('../escape.md')).toBe(false)
    expect(isSafeWizardRelativePath('/absolute/path.md')).toBe(false)
    expect(isSafeWizardRelativePath('bad\\escape.md')).toBe(false)
    expect(isSafeWizardRelativePath('')).toBe(false)
  })

  it('creates auditable source pointers without dropping source identity fields', () => {
    const pointer = createWizardSourcePointer({
      path: '/tmp/messy-case/Intake Docs.pdf',
      root_relative_path: 'Intake Docs.pdf',
      sha256: 'a'.repeat(64),
      size_bytes: 1234,
      media_type: 'application/pdf',
      discovered_at: '2026-05-14T00:00:00.000Z',
    })

    expect(pointer).toEqual({
      path: '/tmp/messy-case/Intake Docs.pdf',
      root_relative_path: 'Intake Docs.pdf',
      sha256: 'a'.repeat(64),
      size_bytes: 1234,
      media_type: 'application/pdf',
      discovered_at: '2026-05-14T00:00:00.000Z',
    })
  })

  it('exports the Wizard contract shapes needed by later slices', () => {
    expectTypeOf<WizardSourceFile>().toMatchTypeOf<{
      path: string
      root_relative_path?: string
      sha256: string
      size_bytes: number
      media_type?: string
      discovered_at: string
    }>()
    expectTypeOf<WizardShadowDocumentFrontmatter>().toMatchTypeOf<{ schema_version: 1; shadow_type: 'document' }>()
    expectTypeOf<WizardClassification>().toMatchTypeOf<{ kind: string; confidence: 'low' | 'medium' | 'high' }>()
    expectTypeOf<WizardQuestion>().toMatchTypeOf<{ id: string; status: 'pending' | 'answered' | 'skipped' }>()
    expectTypeOf<WizardAnswer>().toMatchTypeOf<{ question_id: string; answer: string }>()
    expectTypeOf<WizardAdoptionPlan>().toMatchTypeOf<{ schema_version: 1; proposed_facts: unknown[] }>()
  })
})
