import { describe, it, expect } from 'vitest'
import { parseQuestManifest, isQuestManifest, type QuestManifest } from '../manifest.js'

describe('parseQuestManifest', () => {
  it('parses a minimal valid manifest', () => {
    const yaml = `
schema_version: 1
slug: waypoint
name: GSD Lifecycle
workflow: gsd.workflow.yaml
`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.slug).toBe('waypoint')
    expect(result.manifest.name).toBe('GSD Lifecycle')
    expect(result.manifest.schema_version).toBe(1)
    expect(result.manifest.workflow).toBe('gsd.workflow.yaml')
  })

  it('parses a full manifest with all optional fields', () => {
    const yaml = `
schema_version: 1
slug: research-spike
name: Research Spike
description: Short-form research quest
workflow: research-spike.workflow.yaml
recipes:
  - doc-writer
  - researcher
scaffolds:
  workstreams:
    - key: core
      name: Core
      milestones:
        - version_label: v1
          title: Initial
          phases:
            - phase_key: "10"
              phase_slug: discuss
              lifecycle_phase: discuss
metadata:
  owner: aaron
  tags:
    - research
`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const m = result.manifest
    expect(m.description).toBe('Short-form research quest')
    expect(m.recipes).toEqual(['doc-writer', 'researcher'])
    expect(m.scaffolds?.workstreams?.[0]?.key).toBe('core')
    expect(m.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases?.[0]?.phase_slug).toBe('discuss')
    expect(m.metadata?.owner).toBe('aaron')
  })

  it('rejects empty input', () => {
    const result = parseQuestManifest('')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('empty_input')
  })

  it('rejects non-string input', () => {
    const result = parseQuestManifest(null as unknown as string)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('invalid_input')
  })

  it('rejects invalid YAML', () => {
    const result = parseQuestManifest('slug: [unclosed')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('parse_error')
  })

  it('rejects non-map top level', () => {
    const result = parseQuestManifest('- just\n- a\n- list')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('not_a_map')
  })

  it('rejects missing schema_version', () => {
    const yaml = `slug: x\nname: X\nworkflow: x.yaml\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('missing_schema_version')
  })

  it('rejects unknown schema_version', () => {
    const yaml = `schema_version: 99\nslug: x\nname: X\nworkflow: x.yaml\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('unsupported_schema_version')
  })

  it('rejects missing slug', () => {
    const yaml = `schema_version: 1\nname: X\nworkflow: x.yaml\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('slug')
  })

  it('rejects missing name', () => {
    const yaml = `schema_version: 1\nslug: x\nworkflow: x.yaml\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('name')
  })

  it('rejects missing workflow', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('workflow')
  })

  it('rejects non-string slug', () => {
    const yaml = `schema_version: 1\nslug: 42\nname: X\nworkflow: x.yaml\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('slug')
  })

  it('rejects non-array recipes', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nworkflow: x.yaml\nrecipes: "nope"\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('recipes')
  })

  it('rejects non-string recipe entries', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nworkflow: x.yaml\nrecipes:\n  - 1\n  - two\n`
    const result = parseQuestManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('recipes[0]')
  })
})

describe('isQuestManifest', () => {
  it('returns true for valid manifest', () => {
    const m: QuestManifest = {
      schema_version: 1,
      slug: 'x',
      name: 'X',
      workflow: 'x.yaml',
    }
    expect(isQuestManifest(m)).toBe(true)
  })

  it('returns false for non-object', () => {
    expect(isQuestManifest(null)).toBe(false)
    expect(isQuestManifest('x')).toBe(false)
    expect(isQuestManifest(42)).toBe(false)
  })

  it('returns false for missing required fields', () => {
    expect(isQuestManifest({ schema_version: 1, slug: 'x', name: 'X' })).toBe(false)
    expect(isQuestManifest({ schema_version: 1, slug: 'x', workflow: 'x.yaml' })).toBe(false)
    expect(isQuestManifest({ slug: 'x', name: 'X', workflow: 'x.yaml' })).toBe(false)
  })
})
