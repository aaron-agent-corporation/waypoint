import { describe, it, expect } from 'vitest'
import { parseRecipeManifest, isRecipeManifest, type RecipeManifest } from '../manifest.js'

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
  model: claude-sonnet-4
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
