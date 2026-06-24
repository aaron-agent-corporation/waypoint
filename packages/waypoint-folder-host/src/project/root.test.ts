import { mkdir, mkdtemp } from 'node:fs/promises'
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
})
