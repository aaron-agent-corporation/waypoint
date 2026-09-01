import { describe, it, expect } from 'vitest'
import { parseRecipeManifest, isRecipeManifest, type RecipeManifest } from '../manifest.ts'

describe('parseRecipeManifest', () => {
  it('parses a minimal valid manifest', () => {
    const yaml = `
schema_version: 1
slug: doc-writer
name: Doc Writer
prompt: |
  You are a doc writer.
  Write good docs.
`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.slug).toBe('doc-writer')
    expect(result.manifest.name).toBe('Doc Writer')
    expect(result.manifest.prompt).toContain('You are a doc writer.')
  })

  it('parses a full manifest with all optional fields', () => {
    const yaml = `
schema_version: 1
slug: planner
name: Planner
description: Plans things
prompt: |
  You plan.
runtime:
  # kind: pi — one of the two kinds that consume tools:, which the parser
  # now refuses on any other kind (item 29).
  kind: pi
  model: claude-sonnet-4
  model_class: medium
  temperature: 0.2
  max_tokens: 4000
tools:
  - read_file
  - write_file
subagents:
  - doc-writer
  - researcher
metadata:
  owner: aaron
  tags:
    - planning
`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const m = result.manifest
    expect(m.description).toBe('Plans things')
    expect(m.runtime?.model).toBe('claude-sonnet-4')
    expect(m.runtime?.model_class).toBe('medium')
    expect(m.runtime?.temperature).toBe(0.2)
    expect(m.tools).toEqual(['read_file', 'write_file'])
    expect(m.subagents).toEqual(['doc-writer', 'researcher'])
    expect(m.metadata?.owner).toBe('aaron')
  })

  it('rejects empty input', () => {
    const result = parseRecipeManifest('')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('empty_input')
  })

  it('rejects non-string input', () => {
    const result = parseRecipeManifest(null as unknown as string)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_input')
  })

  it('rejects invalid YAML', () => {
    const result = parseRecipeManifest('slug: [unclosed')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('parse_error')
  })

  it('rejects non-map top level', () => {
    const result = parseRecipeManifest('- list\n- items')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('not_a_map')
  })

  it('rejects missing schema_version', () => {
    const yaml = `slug: x\nname: X\nprompt: p\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_schema_version')
  })

  it('rejects unsupported schema_version', () => {
    const yaml = `schema_version: 99\nslug: x\nname: X\nprompt: p\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('unsupported_schema_version')
  })

  it('rejects missing required fields', () => {
    for (const field of ['slug', 'name', 'prompt']) {
      const lines = ['schema_version: 1', 'slug: x', 'name: X', 'prompt: p'].filter(
        (l) => !l.startsWith(`${field}:`),
      )
      const yaml = lines.join('\n') + '\n'
      const result = parseRecipeManifest(yaml)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.error.code).toBe('missing_field')
      expect(result.error.path).toBe(field)
    }
  })

  it('rejects empty prompt string', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: ""\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('prompt')
  })

  it('carries runtime.tool_group through — the declaration is not the wiring', () => {
    // Until 2026-08-08 the type declared tool_group, the recipes set it, and
    // the parser dropped it building the hints object. Downstream that meant
    // WAYPOINT_TOOL_GROUP was never set: every in-vivo worker got the FULL
    // closed-surface tool set and no report guard ever ran outside tests.
    const result = parseRecipeManifest(`
schema_version: 1
slug: x
name: X
prompt: p
runtime:
  tool_group: extract
`)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifest.runtime?.tool_group).toBe('extract')
  })

  it('rejects an empty runtime.tool_group', () => {
    const result = parseRecipeManifest(`
schema_version: 1
slug: x
name: X
prompt: p
runtime:
  tool_group: ''
`)
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown runtime.model_class', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nruntime:\n  model_class: turbo\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('runtime.model_class')
  })

  it('rejects non-object runtime', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nruntime: "nope"\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('runtime')
  })

  it('rejects non-number runtime.temperature', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nruntime:\n  temperature: hot\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('runtime.temperature')
  })

  it('accepts runtime.kind: pi (an in-process agent recipe, prompt required, no entrypoint)', () => {
    const yaml = `schema_version: 1\nslug: pi-worker\nname: Pi Worker\nprompt: do the thing\nruntime:\n  kind: pi\n  model_class: high\ntools:\n  - read_file\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.manifest.runtime?.kind).toBe('pi')
    expect(result.manifest.runtime?.model_class).toBe('high')
    expect(result.manifest.tools).toEqual(['read_file'])
  })

  it('requires a prompt for runtime.kind: pi (unlike deterministic)', () => {
    const yaml = `schema_version: 1\nslug: pi-worker\nname: Pi Worker\nruntime:\n  kind: pi\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('missing_field')
    expect(result.error.path).toBe('prompt')
  })

  it('rejects an unknown runtime.kind', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nruntime:\n  kind: wizard\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('runtime.kind')
  })

  it('rejects non-array tools', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\ntools: "one"\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('tools')
  })

  it('rejects non-string tool entries', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\ntools:\n  - 1\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('tools[0]')
  })

  it('rejects non-array subagents', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nsubagents: "one"\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('subagents')
  })

  it('rejects non-string subagent entries', () => {
    const yaml = `schema_version: 1\nslug: x\nname: X\nprompt: p\nsubagents:\n  - 1\n`
    const result = parseRecipeManifest(yaml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_field_type')
    expect(result.error.path).toBe('subagents[0]')
  })
})

describe('isRecipeManifest', () => {
  it('returns true for valid manifest', () => {
    const m: RecipeManifest = {
      schema_version: 1,
      slug: 'x',
      name: 'X',
      prompt: 'p',
    }
    expect(isRecipeManifest(m)).toBe(true)
  })

  it('returns false for non-object', () => {
    expect(isRecipeManifest(null)).toBe(false)
    expect(isRecipeManifest('x')).toBe(false)
  })

  it('returns false for missing required fields', () => {
    expect(isRecipeManifest({ schema_version: 1, slug: 'x', name: 'X' })).toBe(false)
    expect(isRecipeManifest({ schema_version: 1, slug: 'x', prompt: 'p' })).toBe(false)
  })
})
