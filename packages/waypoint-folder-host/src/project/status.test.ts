import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PostgresTestProjects } from '../testing/postgres'
import { initWaypointProject } from './init'
import { readWaypointStatus } from './status'

// Status reads route summaries from the postgres store (P5) — needs the test instance.
const projects = new PostgresTestProjects()

beforeAll(() => {
  projects.setEnv()
})

afterAll(async () => {
  await projects.cleanup()
})

describe('readWaypointStatus', () => {
  it('reports missing config before init', async () => {
    const projectRoot = await projects.mkProjectRoot('runner-status-')

    const status = await readWaypointStatus(projectRoot)

    expect(status.initialized).toBe(false)
    expect(status.enabled).toBe(false)
    expect(status.quest).toBeNull()
    expect(status.backend).toBeNull()
    expect(status.configPath).toBe(join(projectRoot, '.waypoint/config.yaml'))
  })

  it('reports enabled project config after init', async () => {
    const projectRoot = await projects.mkProjectRoot('runner-status-')
    await initWaypointProject(projectRoot, { quest: 'runner' })

    const status = await readWaypointStatus(projectRoot)

    expect(status.initialized).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.quest).toBe('runner')
    expect(status.backend).toBe('postgres')
    expect(status.routes).toEqual({ total: 0, active: 0, blocked: 0, blockedGates: 0 })
  })
})
