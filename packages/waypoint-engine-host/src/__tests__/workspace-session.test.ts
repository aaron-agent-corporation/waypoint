import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkspaceSession } from '../core/workspace-session.ts'
import { cleanup, delay, makeTempDir } from './helpers/workspace.ts'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

describe('WorkspaceSession', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir()
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('throws a NO_WORKSPACE EngineError before any workspace is open', () => {
    const session = new WorkspaceSession()
    expect(session.current()).toBeNull()
    try {
      session.requireActive()
      throw new Error('expected requireActive to throw')
    } catch (error) {
      expect((error as { details?: { code?: string } }).details?.code).toBe('NO_WORKSPACE')
    }
  })

  it('initializes a fresh folder workspace and installs the bundled catalog', async () => {
    const session = new WorkspaceSession()
    const state = await session.open({ root: dir, backend: 'folder' })
    expect(state).toEqual({ root: dir, backend: 'folder', initialized: true })
    const status = await session.status()
    expect(status.initialized).toBe(true)
    expect(status.backend).toBe('folder')
    // Catalog installed → startQuestRoute (Task 7) can read this manifest.
    expect(await exists(join(dir, '.waypoint', 'quests', 'waypoint.yaml'))).toBe(true)
  })

  it('rejects opening an existing workspace with a conflicting backend', async () => {
    const session = new WorkspaceSession()
    await session.open({ root: dir, backend: 'folder' })
    const other = new WorkspaceSession()
    await expect(other.open({ root: dir, backend: 'beads' })).rejects.toMatchObject({
      details: { code: 'CONFLICT' },
    })
  })

  it('refuses to switch workspace while a run is in flight unless forced', async () => {
    const session = new WorkspaceSession()
    await session.open({ root: dir, backend: 'folder' })
    let release!: () => void
    const inFlight = session.runGuard(
      () =>
        new Promise<void>((r) => {
          release = () => r()
        }),
    )
    const second = await makeTempDir()
    try {
      await expect(session.open({ root: second, backend: 'folder' })).rejects.toThrow(/runs are active/)
      await expect(session.open({ root: second, backend: 'folder', force: true })).resolves.toMatchObject({ root: second })
    } finally {
      release()
      await inFlight
      await cleanup(second)
    }
  })

  it('mutate() serializes overlapping operations (no interleave)', async () => {
    const session = new WorkspaceSession()
    await session.open({ root: dir, backend: 'folder' })
    const order: string[] = []
    const p1 = session.mutate(async () => {
      order.push('1-start')
      await delay(20)
      order.push('1-end')
    })
    const p2 = session.mutate(async () => {
      order.push('2-start')
      order.push('2-end')
    })
    await Promise.all([p1, p2])
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
  })

  it('exposes no beads client options for a folder workspace', async () => {
    const session = new WorkspaceSession()
    await session.open({ root: dir, backend: 'folder' })
    expect(session.beadsOptions()).toEqual({})
  })
})
