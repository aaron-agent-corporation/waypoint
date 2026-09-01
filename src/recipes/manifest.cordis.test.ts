import { describe, expect, it } from 'vitest'

import { parseRecipeManifest } from './manifest.ts'

/**
 * Schema v1 gains `runtime.kind: cordis` plus two cordis-only fields.
 *
 * Every case here is a REFUSAL case, and that is the point. The `tool_group`
 * incident is the reason: the type declared the field, the recipes set it, the
 * parser dropped it, and for months every worker silently ran with the full
 * tool surface. A recipe field that is quietly ignored is worse than one that
 * does not exist, because the author believes it is doing something.
 */

const base = [
  'schema_version: 1',
  'slug: extractor',
  'name: Extractor',
  'prompt: You extract encounters.',
].join('\n')

function parse(extra: string) {
  return parseRecipeManifest(`${base}\n${extra}\n`)
}

const CORDIS = 'runtime:\n  kind: cordis\n  model_class: medium\n  tool_group: extract'

describe('runtime.kind: cordis', () => {
  it('is accepted as a kind', () => {
    const result = parse(CORDIS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.runtime?.kind).toBe('cordis')
  })

  it('still refuses an unknown kind rather than defaulting to agent', () => {
    const result = parse('runtime:\n  kind: cordys')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('cordis')
  })

  it('refuses an entrypoint on a cordis recipe instead of ignoring it', () => {
    const result = parse(`${CORDIS}\n  entrypoint: assemble-package`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.path).toBe('runtime.entrypoint')
  })
})

describe('runtime.max_turns', () => {
  it('carries a positive whole number through', () => {
    const result = parse(`${CORDIS}\n  max_turns: 120`)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.runtime?.max_turns).toBe(120)
  })

  it('is absent when the recipe does not set it, so the runtime default applies', () => {
    const result = parse(CORDIS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.runtime?.max_turns).toBeUndefined()
  })

  it('refuses zero and negatives — a worker with no turns is not a budget', () => {
    for (const bad of [0, -5]) {
      const result = parse(`${CORDIS}\n  max_turns: ${bad}`)
      expect(result.ok, String(bad)).toBe(false)
    }
  })

  it('refuses a fraction', () => {
    const result = parse(`${CORDIS}\n  max_turns: 12.5`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.path).toBe('runtime.max_turns')
  })

  it('refuses it on a non-cordis recipe, because no other runtime reads it', () => {
    const result = parse('runtime:\n  kind: pi\n  max_turns: 50')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('only meaningful for runtime.kind: cordis')
  })
})

describe('skills and references', () => {
  it('carries them through to the manifest', () => {
    const result = parse(`${CORDIS}\nskills:\n  - cite-discipline\nreferences:\n  - reference/vocabulary.md`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.skills).toEqual(['cite-discipline'])
      expect(result.manifest.references).toEqual(['reference/vocabulary.md'])
    }
  })

  it('leaves them absent when the recipe does not set them', () => {
    const result = parse(CORDIS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.skills).toBeUndefined()
      expect(result.manifest.references).toBeUndefined()
    }
  })

  it('refuses them on a non-cordis recipe, because no other runtime reads them', () => {
    const result = parse('runtime:\n  kind: pi\nskills:\n  - cite-discipline')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.path).toBe('skills')
      expect(result.error.message).toContain('only meaningful for runtime.kind: cordis')
    }
  })

  it('refuses them on a recipe with no runtime block at all', () => {
    const result = parse('references:\n  - reference/vocabulary.md')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.path).toBe('references')
  })

  it('refuses a non-list', () => {
    const result = parse(`${CORDIS}\nskills: cite-discipline`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('must be an array')
  })

  it('refuses an empty entry, which would resolve to a nameless file', () => {
    const result = parse(`${CORDIS}\nskills:\n  - ''`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.path).toBe('skills[0]')
  })

  it('refuses a duplicate, which would mount the same section twice', () => {
    const result = parse(`${CORDIS}\nskills:\n  - cite-discipline\n  - cite-discipline`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('more than once')
  })
})

/**
 * Item 29 (D2): `tools:` on a kind that never reads it looked like a sandbox
 * and restricted nothing — 78 recipes carried one. Same refusal discipline as
 * the cordis-only fields; the predicate is derived (H-6), never restated.
 */
describe('tools: is refused on kinds that never read it', () => {
  it('refuses tools on the default (agent/worker) kind', () => {
    const result = parse('tools:\n  - file_read')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.path).toBe('tools')
      expect(result.error.message).toContain('pi / cordis')
    }
  })

  it('refuses tools on kind: deterministic', () => {
    const result = parse('runtime:\n  kind: deterministic\n  entrypoint: assemble-package\ntools:\n  - file_read')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.path).toBe('tools')
  })

  it('accepts tools on cordis and pi — the kinds that enforce it', () => {
    const cordis = parse(`${CORDIS}\ntools:\n  - write_encounter`)
    expect(cordis.ok).toBe(true)
    if (cordis.ok) expect(cordis.manifest.tools).toEqual(['write_encounter'])

    const pi = parse('runtime:\n  kind: pi\n  model_class: medium\ntools:\n  - read')
    expect(pi.ok).toBe(true)
    if (pi.ok) expect(pi.manifest.tools).toEqual(['read'])
  })
})
