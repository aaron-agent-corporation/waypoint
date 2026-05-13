import { describe, expect, it } from 'vitest'
import { parseHandoffManifest, isHandoffManifest, type HandoffManifest, type HandoffStep, type HandoffManifestParseResult, type HandoffManifestParseError } from '../manifest.js'

describe('parseHandoffManifest', () => {
  const minimalYaml = `
schema_version: 1
slug: firmvault-paralegal-handoffs
name: FirmVault Paralegal Handoffs
handoffs:
  - slug: paralegal-to-attorney-demand-review
    from: firmvault-paralegal
    to: attorney-review
    trigger: demand_package_ready
    gate: human_attorney_review
`

  it('parses a valid handoff manifest', () => {
    const result = parseHandoffManifest(minimalYaml)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.slug).toBe('firmvault-paralegal-handoffs')
    expect(result.manifest.name).toBe('FirmVault Paralegal Handoffs')
    expect(result.manifest.handoffs).toHaveLength(1)

    const step = result.manifest.handoffs[0]
    expect(step.slug).toBe('paralegal-to-attorney-demand-review')
    expect(step.from).toBe('firmvault-paralegal')
    expect(step.to).toBe('attorney-review')
    expect(step.trigger).toBe('demand_package_ready')
    expect(step.gate).toBe('human_attorney_review')
  })

  it('parses handoffs with required_artifacts', () => {
    const yaml = `
schema_version: 1
slug: firmvault-paralegal-handoffs
name: FirmVault Paralegal Handoffs
handoffs:
  - slug: paralegal-to-attorney-demand-review
    from: firmvault-paralegal
    to: attorney-review
    trigger: demand_package_ready
    required_artifacts:
      - docs/demand-summary.md
      - .waypoint/firmvault/case.yaml
    gate: human_attorney_review
`
    const result = parseHandoffManifest(yaml)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.handoffs[0].required_artifacts).toEqual([
      'docs/demand-summary.md',
      '.waypoint/firmvault/case.yaml',
    ])
  })

  it('parses handoffs with optional metadata', () => {
    const yaml = `
schema_version: 1
slug: firmvault-paralegal-handoffs
name: FirmVault Paralegal Handoffs
description: Handoff graph for FirmVault paralegal workflow
handoffs:
  - slug: paralegal-to-attorney
    from: firmvault-paralegal
    to: attorney-review
    trigger: demand_package_ready
metadata:
  source: firmvault-port-part-six
`
    const result = parseHandoffManifest(yaml)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.description).toBe('Handoff graph for FirmVault paralegal workflow')
    expect(result.manifest.metadata?.source).toBe('firmvault-port-part-six')
  })

  it('requires schema_version', () => {
    const result = parseHandoffManifest('slug: test\nname: Test\nhandoffs: []')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_schema_version')
    expect(result.error.path).toBe('schema_version')
  })

  it('requires slug', () => {
    const result = parseHandoffManifest(`schema_version: 1\nname: Test\nhandoffs: []`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('slug')
  })

  it('requires name', () => {
    const result = parseHandoffManifest(`schema_version: 1\nslug: test\nhandoffs: []`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('name')
  })

  it('requires handoffs array', () => {
    const result = parseHandoffManifest(`schema_version: 1\nslug: test\nname: Test`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('handoffs')
  })

  it('rejects empty handoffs array', () => {
    const result = parseHandoffManifest(`schema_version: 1\nslug: test\nname: Test\nhandoffs: []`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
  })

  it('rejects handoff missing slug', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - from: a
    to: b
    trigger: t
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toContain('handoffs[0].slug')
  })

  it('rejects handoff missing from', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    to: b
    trigger: t
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toContain('handoffs[0].from')
  })

  it('rejects handoff missing to', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    from: a
    trigger: t
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toContain('handoffs[0].to')
  })

  it('rejects handoff missing trigger', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    from: a
    to: b
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toContain('handoffs[0].trigger')
  })

  it('rejects unsupported schema version', () => {
    const result = parseHandoffManifest(`schema_version: 99\nslug: test\nname: Test\nhandoffs:\n  - slug: a\n    from: a\n    to: b\n    trigger: t\n`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('unsupported_schema_version')
  })

  it('rejects non-string gate when present', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    from: a
    to: b
    trigger: t
    gate: 123
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toContain('handoffs[0].gate')
  })

  it('allows handoff without gate (human handoff implicit)', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    from: a
    to: b
    trigger: t
    required_artifacts:
      - file.txt
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.handoffs[0].gate).toBeUndefined()
    expect(result.manifest.handoffs[0].required_artifacts).toEqual(['file.txt'])
  })

  it('rejects non-array required_artifacts', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a-to-b
    from: a
    to: b
    trigger: t
    required_artifacts: not-an-array
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
  })

  it('rejects non-array handoffs', () => {
    const result = parseHandoffManifest(`schema_version: 1\nslug: test\nname: Test\nhandoffs: not-array`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
  })

  it('rejects non-string required_artifacts element', () => {
    const yaml = `
schema_version: 1
slug: test
name: Test
handoffs:
  - slug: a
    from: a
    to: b
    trigger: t
    required_artifacts:
      - 123
`
    const result = parseHandoffManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
  })
})

describe('isHandoffManifest', () => {
  it('returns true for valid handoff manifest objects', () => {
    const manifest: HandoffManifest = {
      schema_version: 1,
      slug: 'test-handoffs',
      name: 'Test Handoffs',
      handoffs: [
        {
          slug: 'a-to-b',
          from: 'operator-a',
          to: 'operator-b',
          trigger: 'event-x',
        },
      ],
    }

    expect(isHandoffManifest(manifest)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isHandoffManifest(null)).toBe(false)
  })

  it('returns false for object missing handoffs', () => {
    expect(
      isHandoffManifest({
        schema_version: 1,
        slug: 'x',
        name: 'X',
      }),
    ).toBe(false)
  })

  it('returns false for empty handoffs array', () => {
    expect(
      isHandoffManifest({
        schema_version: 1,
        slug: 'x',
        name: 'X',
        handoffs: [],
      }),
    ).toBe(false)
  })
})

describe('HandoffStep type structure', () => {
  it('constructs a minimal valid HandoffStep', () => {
    const step: HandoffStep = {
      slug: 'test-step',
      from: 'operator-a',
      to: 'operator-b',
      trigger: 'event-x',
    }

    expect(step.slug).toBe('test-step')
    expect(step.gate).toBeUndefined()
    expect(step.required_artifacts).toBeUndefined()
  })

  it('constructs a full HandoffStep with gate and artifacts', () => {
    const step: HandoffStep = {
      slug: 'full-step',
      from: 'operator-a',
      to: 'operator-b',
      trigger: 'event-x',
      gate: 'human_review',
      required_artifacts: ['doc1.md', 'doc2.md'],
    }

    expect(step.gate).toBe('human_review')
    expect(step.required_artifacts).toEqual(['doc1.md', 'doc2.md'])
  })
})