import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import type { WaypointProjectRootConfig } from '../project/config.ts'
import { buildPiFsTools, isPiFsTool, PI_FS_TOOL_NAMES } from './pi-fs-tools.ts'

/**
 * The in-process fs tools ARE the write boundary for a pi worker (rsc-bhc), so
 * these tests hammer the confinement: reads/writes confined to the plan's
 * access map, symlink escapes resolved and denied, ro holes (incl. the mandatory
 * `.git/hooks`) refused, and fail-closed on a missing/invalid access map.
 */

// A file/dir tree: src (base ro) + build (base rw), each with a file.
async function fixture(): Promise<{
  root: string
  roots: Record<string, WaypointProjectRootConfig>
}> {
  const root = await mkdtemp(join(tmpdir(), 'pi-fs-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'build'), { recursive: true })
  await writeFile(join(root, 'src', 'a.txt'), 'source-a', 'utf8')
  await writeFile(join(root, 'build', 'b.txt'), 'build-b', 'utf8')
  return {
    root,
    roots: {
      source: { path: 'src', access: 'ro' },
      build: { path: 'build', access: 'rw' },
    },
  }
}

async function tools(
  root: string,
  roots: Record<string, WaypointProjectRootConfig>,
  access: Record<string, string>,
  names: readonly string[] = PI_FS_TOOL_NAMES,
): Promise<Record<string, AgentTool>> {
  return buildPiFsTools({ projectRoot: root, roots, access, scratchDir: join(root, '.waypoint', 'scratch', 'r', 't'), names: names as never })
}

// A tool's execute returns the model-visible content; pull the first text out.
async function run(tool: AgentTool, params: Record<string, unknown>): Promise<string> {
  const result = await tool.execute('tc', params as never)
  const first = result.content[0]
  return first && first.type === 'text' ? first.text : ''
}

describe('pi fs tools — read confinement (rsc-bhc)', () => {
  it('reads a file inside a ro root and inside a rw root', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { source: 'ro', build: 'rw' })
    expect(await run(t.read_file!, { path: 'src/a.txt' })).toBe('source-a')
    expect(await run(t.read_file!, { path: 'build/b.txt' })).toBe('build-b')
  })

  it('DENIES a read outside every granted root', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { build: 'rw' }) // source not granted this run
    await expect(run(t.read_file!, { path: 'src/a.txt' })).rejects.toThrow(/outside every granted access root/)
    await expect(run(t.read_file!, { path: '../escape.txt' })).rejects.toThrow(/denied/)
  })

  it('lists a granted directory', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { build: 'rw' })
    const listing = await run(t.list_dir!, { path: 'build' })
    expect(listing).toContain('b.txt')
  })
})

describe('pi fs tools — write confinement (rsc-bhc)', () => {
  it('writes inside a rw root, and the bytes land on disk', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { source: 'ro', build: 'rw' })
    await run(t.write_file!, { path: 'build/out/new.txt', content: 'written' })
    expect(await readFile(join(root, 'build', 'out', 'new.txt'), 'utf8')).toBe('written')
  })

  it('DENIES a write into a read-only root (no escalation)', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { source: 'ro', build: 'rw' })
    await expect(run(t.write_file!, { path: 'src/a.txt', content: 'tampered' })).rejects.toThrow(/READ-ONLY root/)
    expect(await readFile(join(root, 'src', 'a.txt'), 'utf8')).toBe('source-a')
  })

  it('DENIES a write outside every granted root', async () => {
    const { root, roots } = await fixture()
    const t = await tools(root, roots, { build: 'rw' })
    await expect(run(t.write_file!, { path: '/tmp/evil.txt', content: 'x' })).rejects.toThrow(/outside every granted access root/)
  })
})

describe('pi fs tools — symlink escape + mandatory holes (rsc-bhc)', () => {
  it('resolves a symlink out of a rw root and DENIES the escape', async () => {
    const { root, roots } = await fixture()
    // A directory OUTSIDE the project, and a symlink to it planted in the rw root.
    const outside = await mkdtemp(join(tmpdir(), 'pi-fs-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, join(root, 'build', 'link'))
    const t = await tools(root, roots, { build: 'rw' })
    // read/write THROUGH the symlink resolve to `outside`, which is under no root.
    await expect(run(t.read_file!, { path: 'build/link/secret.txt' })).rejects.toThrow(/outside every granted access root/)
    await expect(run(t.write_file!, { path: 'build/link/planted.txt', content: 'x' })).rejects.toThrow(/outside every granted access root/)
  })

  it('DENIES a write to the mandatory .git/hooks hole even under a rw root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fs-git-'))
    // One broad rw root over the whole project; the mandatory holes still win.
    const t = await tools(root, { all: { path: '.', access: 'rw' } }, { all: 'rw' })
    await expect(run(t.write_file!, { path: '.git/hooks/pre-commit', content: '#!/bin/sh\n' })).rejects.toThrow(/READ-ONLY root/)
    // a normal file under the same rw root is fine
    await run(t.write_file!, { path: 'notes.txt', content: 'ok' })
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('ok')
  })
})

describe('pi fs tools — fail-closed build (rsc-bhc)', () => {
  it('refuses to build when the plan declares NO access map', async () => {
    const { root, roots } = await fixture()
    await expect(
      buildPiFsTools({ projectRoot: root, roots, access: undefined, scratchDir: join(root, '.waypoint', 's'), names: ['read_file'] }),
    ).rejects.toThrow(/no access map/)
  })

  it('refuses to build when the access map names an undeclared root', async () => {
    const { root } = await fixture()
    await expect(
      buildPiFsTools({ projectRoot: root, roots: {}, access: { nope: 'rw' }, scratchDir: join(root, '.waypoint', 's'), names: ['read_file'] }),
    ).rejects.toThrow(/no such root/)
  })

  it('refuses rw on a base-ro root (escalation)', async () => {
    const { root, roots } = await fixture()
    await expect(
      buildPiFsTools({ projectRoot: root, roots, access: { source: 'rw' }, scratchDir: join(root, '.waypoint', 's'), names: ['read_file'] }),
    ).rejects.toThrow(/escalation refused/)
  })

  it('recognizes exactly the three vetted fs tool names', () => {
    expect(PI_FS_TOOL_NAMES).toEqual(['read_file', 'write_file', 'list_dir'])
    expect(isPiFsTool('read_file')).toBe(true)
    expect(isPiFsTool('submit_report')).toBe(false)
    expect(isPiFsTool('bash')).toBe(false)
  })
})
