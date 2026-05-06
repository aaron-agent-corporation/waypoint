import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRecipesFromDirectory } from '../loader.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'waypoint-recipe-load-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(relPath: string, content: string): void {
  const full = join(dir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

describe('loadRecipesFromDirectory', () => {
  it('returns empty registry for empty directory', async () => {
    const result = await loadRecipesFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(0)
  })

  it('recursively loads recipes from nested directories', async () => {
    write('doc-writer.yaml', `schema_version: 1\nslug: doc-writer\nname: Doc Writer\nprompt: p\n`)
    write('writing/editor.yaml', `schema_version: 1\nslug: editor\nname: Editor\nprompt: p\n`)
    write('research/deep/scout.yaml', `schema_version: 1\nslug: scout\nname: Scout\nprompt: p\n`)
    const result = await loadRecipesFromDirectory(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.registry.size).toBe(3)
    for (const s of ['doc-writer', 'editor', 'scout']) expect(result.registry.has(s)).toBe(true)
  })

  it('reports parse errors and slug collisions', async () => {
    write('a/dup.yaml', `schema_version: 1\nslug: dup\nname: A\nprompt: p\n`)
    write('b/dup.yaml', `schema_version: 1\nslug: dup\nname: B\nprompt: p\n`)
    write('bad.yaml', `not a map`)
    const result = await loadRecipesFromDirectory(dir)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns directory_not_found for missing path', async () => {
    const result = await loadRecipesFromDirectory(join(dir, 'missing'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0]?.code).toBe('directory_not_found')
  })
})
