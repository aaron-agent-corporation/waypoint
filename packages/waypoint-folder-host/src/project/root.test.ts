import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findWaypointProjectRoot } from './root.ts'

describe('findWaypointProjectRoot', () => {
  it('finds the nearest ancestor containing .waypoint/ from a subdirectory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-find-'))
    await mkdir(join(root, '.waypoint'), { recursive: true })
    const sub = join(root, 'a', 'b')
    await mkdir(sub, { recursive: true })

    expect(await findWaypointProjectRoot(sub)).toBe(root)
  })

  it('returns null when no .waypoint/ ancestor exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-find-none-'))
    expect(await findWaypointProjectRoot(root)).toBeNull()
  })

  it('ignores a stray FILE named .waypoint (only a directory counts as a root)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-find-file-'))
    // A regular file named `.waypoint` must NOT be treated as a project root.
    await writeFile(join(root, '.waypoint'), 'not a dir', 'utf8')

    expect(await findWaypointProjectRoot(root)).toBeNull()
  })

  it('walks past a file-named .waypoint to a real .waypoint/ ancestor', async () => {
    const ancestor = await mkdtemp(join(tmpdir(), 'wp-find-mixed-'))
    await mkdir(join(ancestor, '.waypoint'), { recursive: true })
    const child = join(ancestor, 'child')
    await mkdir(child, { recursive: true })
    await writeFile(join(child, '.waypoint'), 'stray file', 'utf8')

    // From child, the stray file is skipped and the real ancestor dir is found.
    expect(await findWaypointProjectRoot(child)).toBe(ancestor)
  })
})
