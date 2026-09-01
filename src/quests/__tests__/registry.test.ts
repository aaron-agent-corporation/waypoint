import { describe, it, expect } from 'vitest'
import { createQuestRegistry } from '../registry.ts'
import type { QuestManifest } from '../manifest.ts'

function sampleQuest(slug: string, overrides: Partial<QuestManifest> = {}): QuestManifest {
  return {
    schema_version: 1,
    slug,
    name: slug,
    workflow: `${slug}.yaml`,
    ...overrides,
  }
}

describe('createQuestRegistry', () => {
  it('starts empty', () => {
    const r = createQuestRegistry()
    expect(r.size).toBe(0)
    expect(r.list()).toEqual([])
  })

  it('adds a manifest and returns ok', () => {
    const r = createQuestRegistry()
    const result = r.add(sampleQuest('runner'))
    expect(result.ok).toBe(true)
    expect(r.size).toBe(1)
    expect(r.has('runner')).toBe(true)
    expect(r.get('runner')?.slug).toBe('runner')
  })

  it('returns slug_collision error on duplicate slug', () => {
    const r = createQuestRegistry()
    r.add(sampleQuest('runner'))
    const result = r.add(sampleQuest('runner'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('slug_collision')
    expect(r.size).toBe(1)
  })

  it('rejects invalid manifest shape with invalid_manifest error', () => {
    const r = createQuestRegistry()
    const result = r.add({ not: 'a quest' } as unknown as QuestManifest)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error.code).toBe('invalid_manifest')
  })

  it('get returns undefined for unknown slug', () => {
    const r = createQuestRegistry()
    expect(r.get('missing')).toBeUndefined()
  })

  it('list returns sorted array by slug', () => {
    const r = createQuestRegistry()
    r.add(sampleQuest('z-quest'))
    r.add(sampleQuest('a-quest'))
    r.add(sampleQuest('m-quest'))
    const slugs = r.list().map((q) => q.slug)
    expect(slugs).toEqual(['a-quest', 'm-quest', 'z-quest'])
  })

  it('has returns false for unknown slug', () => {
    const r = createQuestRegistry()
    r.add(sampleQuest('runner'))
    expect(r.has('other')).toBe(false)
  })
})
