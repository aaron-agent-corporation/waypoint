import { describe, expect, it } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadHandoffManifestsFromDirectory } from '../loader.ts'

describe('loadHandoffManifestsFromDirectory', () => {
  const tempDir = () =>
    resolve(join(__dirname, `../../../../tmp-handoffs-test-${Date.now()}`))

  async function setup(tempRoot: string) {
    const handoffsDir = join(tempRoot, 'handoffs')
    await mkdir(handoffsDir, { recursive: true })
    return handoffsDir
  }

  async function cleanup(tempRoot: string) {
    // best effort
    try {
      const { rm } = await import('node:fs/promises')
      await rm(tempRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  it('loads a single handoff manifest from a handoffs directory', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    await writeFile(
      join(handoffsDir, 'acme-handoffs.yaml'),
      [
        'schema_version: 1',
        'slug: acme-agent-handoffs',
        'name: Acme Agent Handoffs',
        'handoffs:',
        '  - slug: agent-to-attorney',
        '    from: acme-agent',
        '    to: attorney-review',
        '    trigger: demand_package_ready',
        '    gate: human_attorney_review',
      ].join('\n'),
    )

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifests).toHaveLength(1)
    expect(result.manifests[0].slug).toBe('acme-agent-handoffs')
    expect(result.manifests[0].handoffs).toHaveLength(1)
    expect(result.manifests[0].handoffs[0].slug).toBe('agent-to-attorney')
    expect(result.registry.has('acme-agent-handoffs')).toBe(true)
    expect(result.registry.get('acme-agent-handoffs')?.handoffs[0]?.slug).toBe('agent-to-attorney')

    await cleanup(root)
  })

  it('loads multiple handoff manifests from a directory', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    await writeFile(
      join(handoffsDir, 'acme-handoffs.yaml'),
      [
        'schema_version: 1',
        'slug: acme-handoffs',
        'name: Acme Handoffs',
        'handoffs:',
        '  - slug: fv-to-attorney',
        '    from: acme-agent',
        '    to: attorney-review',
        '    trigger: demand_package_ready',
      ].join('\n'),
    )

    await writeFile(
      join(handoffsDir, 'litigation-handoffs.yaml'),
      [
        'schema_version: 1',
        'slug: litigation-handoffs',
        'name: Litigation Handoffs',
        'handoffs:',
        '  - slug: discovery-to-trial',
        '    from: litigator',
        '    to: trial-prep',
        '    trigger: discovery_complete',
      ].join('\n'),
    )

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifests).toHaveLength(2)
    expect(result.manifests.map((m) => m.slug)).toEqual([
      'acme-handoffs',
      'litigation-handoffs',
    ])

    await cleanup(root)
  })

  it('returns empty array when directory does not exist', async () => {
    const result = await loadHandoffManifestsFromDirectory('/nonexistent/path/handoffs')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifests).toHaveLength(0)
  })

  it('skips invalid manifests and returns errors', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    // Valid manifest
    await writeFile(
      join(handoffsDir, 'valid.yaml'),
      [
        'schema_version: 1',
        'slug: valid-handoffs',
        'name: Valid',
        'handoffs:',
        '  - slug: a-to-b',
        '    from: a',
        '    to: b',
        '    trigger: t',
      ].join('\n'),
    )

    // Invalid manifest (missing schema_version)
    await writeFile(
      join(handoffsDir, 'invalid.yaml'),
      'slug: bad\nname: Bad\nhandoffs:\n  - slug: x\n    from: a\n    to: b\n    trigger: t\n',
    )

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.length).toBeGreaterThanOrEqual(1)

    await cleanup(root)
  })

  it('detects slug collisions across manifests', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    await writeFile(
      join(handoffsDir, 'first.yaml'),
      [
        'schema_version: 1',
        'slug: acme-handoffs',
        'name: Acme Handoffs',
        'handoffs:',
        '  - slug: agent-to-attorney',
        '    from: acme-agent',
        '    to: attorney-review',
        '    trigger: demand_package_ready',
      ].join('\n'),
    )

    await writeFile(
      join(handoffsDir, 'second.yaml'),
      [
        'schema_version: 1',
        'slug: acme-handoffs',
        'name: Acme Handoffs Duplicate',
        'handoffs:',
        '  - slug: agent-to-attorney-2',
        '    from: acme-agent',
        '    to: attorney-review',
        '    trigger: demand_package_ready',
      ].join('\n'),
    )

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.some((e) => e.code === 'slug_collision')).toBe(true)

    await cleanup(root)
  })

  it('returns empty array for an empty directory', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifests).toHaveLength(0)

    await cleanup(root)
  })

  it('only reads .yaml and .yml files', async () => {
    const root = tempDir()
    const handoffsDir = await setup(root)

    // A .txt file should be ignored
    await writeFile(join(handoffsDir, 'readme.txt'), 'not a manifest')

    // A .yaml file should be read
    await writeFile(
      join(handoffsDir, 'handoffs.yaml'),
      [
        'schema_version: 1',
        'slug: test-handoffs',
        'name: Test',
        'handoffs:',
        '  - slug: a-to-b',
        '    from: a',
        '    to: b',
        '    trigger: t',
      ].join('\n'),
    )

    const result = await loadHandoffManifestsFromDirectory(handoffsDir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.manifests).toHaveLength(1)

    await cleanup(root)
  })
})