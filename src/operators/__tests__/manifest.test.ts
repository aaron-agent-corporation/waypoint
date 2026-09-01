import { describe, expect, it } from 'vitest'
import { parseOperatorManifest, isOperatorManifest, type OperatorManifest } from '../manifest.ts'

describe('parseOperatorManifest', () => {
  it('parses a valid operator manifest', () => {
    const yaml = `
schema_version: 1
slug: research-analyst
name: Research Analyst
role: Research Operator
description: Gathers and summarizes project research.
instructions:
  layers:
    - kind: shared
      ref: docs/runner-operator-safety.md
      required: true
    - kind: skill
      ref: research/source-gathering
      required: true
allowed_tools:
  - slug: example.search
    command: waypoint tools search --json
    description: Search the project's sources.
workspace:
  cases_root_key: research_projects
handoffs:
  - slug: human-review
    to: reviewer
    gate: human_review
metadata:
  source: openswarm-pattern-adoption
`

    const result = parseOperatorManifest(yaml)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.slug).toBe('research-analyst')
    expect(result.manifest.role).toBe('Research Operator')
    expect(result.manifest.instructions?.layers?.[0]).toMatchObject({ kind: 'shared', required: true })
    expect(result.manifest.allowed_tools?.[0]).toMatchObject({ slug: 'example.search' })
    expect(result.manifest.workspace?.cases_root_key).toBe('research_projects')
    expect(result.manifest.handoffs?.[0]).toMatchObject({ slug: 'human-review', to: 'reviewer' })
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

  it('rejects unsafe command entries', () => {
    const result = parseOperatorManifest(`
schema_version: 1
slug: x
name: X
role: R
allowed_tools:
  - slug: unsafe
    command: waypoint tools search --json; rm -rf .
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
      slug: 'research-analyst',
      name: 'Research Analyst',
      role: 'Research Operator',
    }

    expect(isOperatorManifest(manifest)).toBe(true)
  })

  it('returns false for incomplete objects', () => {
    expect(isOperatorManifest(null)).toBe(false)
    expect(isOperatorManifest({ schema_version: 1, slug: 'x', name: 'X' })).toBe(false)
  })
})
