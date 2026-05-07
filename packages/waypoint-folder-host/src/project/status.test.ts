import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initWaypointProject } from './init'
import { readWaypointStatus } from './status'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-status-'))
}

describe('readWaypointStatus', () => {
  it('reports missing config before init', async () => {
    const projectRoot = await tempProject()

    const status = await readWaypointStatus(projectRoot)

    expect(status.initialized).toBe(false)
    expect(status.enabled).toBe(false)
    expect(status.quest).toBeNull()
    expect(status.configPath).toBe(join(projectRoot, '.waypoint/config.yaml'))
  })

  it('reports enabled project config after init', async () => {
    const projectRoot = await tempProject()
    await initWaypointProject(projectRoot, { quest: 'gsd' })

    const status = await readWaypointStatus(projectRoot)

    expect(status.initialized).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.quest).toBe('gsd')
  })
})
