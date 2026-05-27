import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { WaypointBeadsCliCommandRunner } from '../beads/cli-client'
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
    await initWaypointProject(projectRoot, { quest: 'waypoint' })

    const status = await readWaypointStatus(projectRoot)

    expect(status.initialized).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.quest).toBe('waypoint')
  })

  it('reports Beads workspace health without trying to read routes when Beads is missing', async () => {
    const projectRoot = await tempProject()
    await initWaypointProject(projectRoot, { quest: 'waypoint', backend: 'beads' })
    const runner: WaypointBeadsCliCommandRunner = {
      async run() {
        return {
          exitCode: 1,
          signal: null,
          stdout: JSON.stringify({
            error: 'no_beads_directory',
            message: 'No active beads workspace found.',
          }),
          stderr: '',
        }
      },
    }

    const status = await readWaypointStatus(projectRoot, { beadsWorkspace: { runner } })

    expect(status.backend).toBe('beads')
    expect(status.routes.total).toBe(0)
    expect(status.beads?.readiness).toMatchObject({ ok: false, status: 'missing-workspace' })
  })

  it('reports Beads root issue ids when workspace and route snapshots are available', async () => {
    const projectRoot = await tempProject()
    await initWaypointProject(projectRoot, { quest: 'waypoint', backend: 'beads' })
    const runner: WaypointBeadsCliCommandRunner = {
      async run() {
        return {
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({ path: `${projectRoot}/.beads`, prefix: 'waypoint' }),
          stderr: '',
        }
      },
    }

    const status = await readWaypointStatus(projectRoot, {
      beadsWorkspace: { runner },
      beadsReader: {
        async listIssueSnapshots() {
          return {
            dependencies: [],
            issues: [
              {
                id: 'bd-001',
                title: 'Route',
                status: 'open',
                metadata: {
                  waypoint: {
                    schema_version: 1,
                    kind: 'route',
                    quest_slug: 'waypoint',
                    route_id: 'route-001',
                    subject: { type: 'project', id: 'local' },
                  },
                },
              },
            ],
          }
        },
      },
    })

    expect(status.beads?.readiness).toMatchObject({ ok: true, status: 'ready', path: `${projectRoot}/.beads` })
    expect(status.beads?.rootIssueIds).toEqual(['bd-001'])
    expect(status.routes.total).toBe(1)
  })
})
