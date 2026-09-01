import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadQuestsFromDirectory } from '../loader.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-quest-load-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(relPath: string, content: string): void {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

describe('loadQuestsFromDirectory', () => {
  it('returns empty registry for empty directory', async () => {
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(0)
  })

  it('returns directory_not_found for missing path', async () => {
    const result = await loadQuestsFromDirectory(join(dir, 'does-not-exist'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0]?.code).toBe('directory_not_found')
  })

  it('loads one quest from a flat layout', async () => {
    write('runner.yaml', `schema_version: 1\nslug: runner\nname: GSD\nworkflow: gsd.wf.yaml\n`)
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(1)
    expect(result.registry.has('runner')).toBe(true)
  })

  it('loads .yml and .yaml extensions', async () => {
    write('a.yaml', `schema_version: 1\nslug: a\nname: A\nworkflow: a.wf.yaml\n`)
    write('b.yml', `schema_version: 1\nslug: b\nname: B\nworkflow: b.wf.yaml\n`)
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(2)
  })

  it('recursively loads from nested directories', async () => {
    write('a.yaml', `schema_version: 1\nslug: a\nname: A\nworkflow: a.wf.yaml\n`)
    write('dev/b.yaml', `schema_version: 1\nslug: b\nname: B\nworkflow: b.wf.yaml\n`)
    write('dev/deep/c.yaml', `schema_version: 1\nslug: c\nname: C\nworkflow: c.wf.yaml\n`)
    write('research/d.yml', `schema_version: 1\nslug: d\nname: D\nworkflow: d.wf.yaml\n`)
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(4)
    for (const s of ['a', 'b', 'c', 'd']) expect(result.registry.has(s)).toBe(true)
  })

  it('ignores non-yaml files', async () => {
    write('a.yaml', `schema_version: 1\nslug: a\nname: A\nworkflow: a.wf.yaml\n`)
    write('notes.txt', 'ignored')
    write('data.json', '{}')
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(1)
  })

  it('collects ALL parse errors not just the first', async () => {
    write('good.yaml', `schema_version: 1\nslug: good\nname: G\nworkflow: g.wf.yaml\n`)
    write('bad-1.yaml', `schema_version: 1\n`) // missing slug/name/workflow
    write('bad-2.yaml', `slug: nope`) // missing schema_version
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('reports slug collisions across directories', async () => {
    write('a/x.yaml', `schema_version: 1\nslug: dup\nname: A\nworkflow: a.wf.yaml\n`)
    write('b/x.yaml', `schema_version: 1\nslug: dup\nname: B\nworkflow: b.wf.yaml\n`)
    const result = await loadQuestsFromDirectory(dir)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.some((e) => e.code === 'slug_collision')).toBe(true)
  })
})
