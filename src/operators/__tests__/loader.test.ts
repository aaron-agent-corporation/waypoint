import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadOperatorsFromDirectory, loadBundledOperators } from '../loader.js'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-operators-'))
}

describe('loadOperatorsFromDirectory', () => {
  it('recursively loads operator manifests', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'firmvault'), { recursive: true })
    await writeFile(
      join(root, 'firmvault', 'paralegal.yaml'),
      `schema_version: 1\nslug: firmvault-paralegal\nname: FirmVault Paralegal\nrole: Paralegal Case Operator\n`,
    )

    const result = await loadOperatorsFromDirectory(root)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.operators.map((operator) => operator.slug)).toEqual(['firmvault-paralegal'])
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
  it('loads the bundled FirmVault paralegal operator', async () => {
    const result = await loadBundledOperators()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    const operator = result.operators.find((entry) => entry.slug === 'firmvault-paralegal')
    expect(operator).toBeDefined()
    expect(operator?.role).toBe('Paralegal Case Operator')
    expect(operator?.allowed_tools?.map((tool) => tool.slug)).toEqual(
      expect.arrayContaining(['firmvault.guidance', 'firmvault.state.set', 'firmvault.landmarks']),
    )
  })
})
