import { describe, expect, it } from 'vitest'
import { parseOperatorManifest, isOperatorManifest, type OperatorManifest } from '../manifest.js'

describe('parseOperatorManifest', () => {
  it('parses a valid FirmVault-style operator manifest', () => {
    const yaml = `
schema_version: 1
slug: firmvault-paralegal
name: FirmVault Paralegal
role: Paralegal Case Operator
description: Safely operates Waypoint FirmVault case folders.
instructions:
  layers:
    - kind: shared
      ref: docs/waypoint-operator-safety.md
      required: true
    - kind: skill
      ref: case-management/firmvault-waypoint-case-operations
      required: true
allowed_tools:
  - slug: firmvault.guidance
    command: waypoint firmvault guidance --json
    description: Inspect next actions.
workspace:
  cases_root_key: firmvault_waypoint_cases
handoffs:
  - slug: attorney-review
    to: attorney
    gate: human_review
metadata:
  source: openswarm-pattern-adoption
`

    const result = parseOperatorManifest(yaml)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.slug).toBe('firmvault-paralegal')
    expect(result.manifest.role).toBe('Paralegal Case Operator')
    expect(result.manifest.instructions?.layers?.[0]).toMatchObject({ kind: 'shared', required: true })
    expect(result.manifest.allowed_tools?.[0]).toMatchObject({ slug: 'firmvault.guidance' })
    expect(result.manifest.workspace?.cases_root_key).toBe('firmvault_waypoint_cases')
    expect(result.manifest.handoffs?.[0]).toMatchObject({ slug: 'attorney-review', to: 'attorney' })
  })

  it('rejects missing slug', () => {
    const result = parseOperatorManifest(`schema_version: 1\nname: X\nrole: R\n`)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('slug')
  })

  it('rejects non-array allowed_tools', () => {
    const result = parseOperatorManifest(`schema_version: 1\nslug: x\nname: X\nrole: R\nallowed_tools: nope\n`)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('allowed_tools')
  })

  it('rejects unsafe FirmVault command entries', () => {
    const result = parseOperatorManifest(`
schema_version: 1
slug: x
name: X
role: R
allowed_tools:
  - slug: unsafe
    command: waypoint firmvault guidance --json; rm -rf .
`)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('unsafe_command')
    expect(result.error.path).toBe('allowed_tools[0].command')
  })
})

describe('isOperatorManifest', () => {
  it('returns true for valid operator manifest objects', () => {
    const manifest: OperatorManifest = {
      schema_version: 1,
      slug: 'firmvault-paralegal',
      name: 'FirmVault Paralegal',
      role: 'Paralegal Case Operator',
    }

    expect(isOperatorManifest(manifest)).toBe(true)
  })

  it('returns false for incomplete objects', () => {
    expect(isOperatorManifest(null)).toBe(false)
    expect(isOperatorManifest({ schema_version: 1, slug: 'x', name: 'X' })).toBe(false)
  })
})
