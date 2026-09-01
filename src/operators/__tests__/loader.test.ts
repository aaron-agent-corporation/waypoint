import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadOperatorsFromDirectory, loadBundledOperators } from '../loader.ts'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'runner-operators-'))
}

describe('loadOperatorsFromDirectory', () => {
  it('recursively loads operator manifests', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'research'), { recursive: true })
    await writeFile(
      join(root, 'research', 'analyst.yaml'),
      `schema_version: 1\nslug: research-analyst\nname: Research Analyst\nrole: Research Operator\n`,
    )

    const result = await loadOperatorsFromDirectory(root)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.operators.map((operator) => operator.slug)).toEqual(['research-analyst'])
  })

  it('reports parse errors with relative paths', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'bad'), { recursive: true })
    await writeFile(join(root, 'bad', 'broken.yaml'), `schema_version: 1\nname: Broken\nrole: Role\n`)

    const result = await loadOperatorsFromDirectory(root)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0]).toMatchObject({ code: 'parse_error', path: 'bad/broken.yaml' })
    expect(result.errors[0].parseError?.path).toBe('slug')
  })

  it('rejects duplicate slugs', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'one.yaml'), `schema_version: 1\nslug: same\nname: One\nrole: Role\n`)
    await writeFile(join(root, 'two.yaml'), `schema_version: 1\nslug: same\nname: Two\nrole: Role\n`)

    const result = await loadOperatorsFromDirectory(root)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors[0].code).toBe('slug_collision')
  })
})

describe('loadBundledOperators', () => {
  it('loads the bundled example operator', async () => {
    const result = await loadBundledOperators()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    // The bundle ships one generic example; real operators are a host
    // extension point dropped into the same directory.
    expect(result.operators.map((operator) => operator.slug)).toEqual(['research-analyst'])
  })
})
