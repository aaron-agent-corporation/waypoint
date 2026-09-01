import { describe, expect, it } from 'vitest'

import { compareWithinSet, questMenuSummary, questSetFor } from './quest-set.ts'

describe('questSetFor', () => {
  it('accepts an explicit metadata.runner.quest_set that names a real set', () => {
    expect(questSetFor({ runner: { quest_set: 'core' }, source: { project: 'anything' } })).toBe('core')
  })

  it('falls back to core for no provenance, unknown sets, and junk metadata', () => {
    expect(questSetFor(undefined)).toBe('core')
    expect(questSetFor({})).toBe('core')
    expect(questSetFor({ source: { project: 'mystery-suite' } })).toBe('core')
    expect(questSetFor({ runner: { quest_set: 'not-a-real-set' } })).toBe('core')
    expect(questSetFor({ runner: 'scalar' })).toBe('core')
    // Provenance strings from removed domain sets no longer map to anything:
    // the set is derived from manifest metadata only, and unknown set names
    // fall back to core.
    expect(questSetFor({ runner: { quest_set: 'legal' }, source: { project: 'llm-lawyer' } })).toBe('core')
    expect(questSetFor({ runner: { source_family: 'llm-lawyer' } })).toBe('core')
    expect(questSetFor({ source: { project: 'llm-lawyer' } })).toBe('core')
    expect(questSetFor({ source: { project: 'get-shit-done-cc' } })).toBe('core')
    expect(questSetFor({ runner: { source_family: 'bmad-method' } })).toBe('core')
  })
})

describe('compareWithinSet', () => {
  it('sorts alphabetically now the coding lifecycle stages are gone (D6)', () => {
    expect(compareWithinSet('aa-new-quest', 'zz-new-quest')).toBeLessThan(0)
    expect(compareWithinSet('beta-quest', 'alpha-quest')).toBeGreaterThan(0)
    expect(compareWithinSet('runner', 'runner')).toBe(0)
  })
})

describe('questMenuSummary', () => {
  it('prefers the authored selection summary', () => {
    expect(questMenuSummary('long description', 'authored line')).toBe('authored line')
  })

  it('strips port boilerplate from descriptions and capitalizes', () => {
    expect(
      questMenuSummary(
        'Waypoint sub-Quest port of gsd:debug for systematic debugging with checkpointable investigation and continuation loops.',
        null,
      ),
    ).toBe('Systematic debugging with checkpointable investigation and continuation loops.')
  })

  it('truncates very long derived lines and handles missing descriptions', () => {
    const summary = questMenuSummary(`Waypoint sub-Quest port of gsd:x for ${'y'.repeat(200)}`, null)
    expect(summary).toHaveLength(100)
    expect(summary?.endsWith('...')).toBe(true)
    expect(questMenuSummary(undefined, null)).toBeNull()
    expect(questMenuSummary('   ', null)).toBeNull()
  })
})
