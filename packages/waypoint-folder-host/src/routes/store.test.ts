import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import { createWaypointRoute, listWaypointRoutes } from './store'

async function tempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-routes-'))
  await initWaypointProject(projectRoot, { quest: 'gsd' })
  return projectRoot
}

describe('folder route YAML store', () => {
  it('creates route records with deterministic ids and readable YAML', async () => {
    const projectRoot = await tempProject()

    const route = await createWaypointRoute(projectRoot, {
      quest: 'gsd',
      subject: { type: 'project', id: 'project' },
      current_node: 'initialize',
      now: new Date('2026-05-07T13:30:00.000Z'),
    })

    expect(route).toMatchObject({
      id: 'route-001',
      quest: 'gsd',
      status: 'active',
      current_node: 'initialize',
      subject: { type: 'project', id: 'project' },
    })

    const yaml = yamlParse(await readFile(join(projectRoot, '.waypoint/routes/route-001.yaml'), 'utf8')) as {
      route: Record<string, unknown>
    }
    expect(yaml.route).toMatchObject({
      id: 'route-001',
      quest: 'gsd',
      status: 'active',
      current_node: 'initialize',
      created_at: '2026-05-07T13:30:00.000Z',
      updated_at: '2026-05-07T13:30:00.000Z',
    })

    const second = await createWaypointRoute(projectRoot, {
      quest: 'debug',
      subject: { type: 'project', id: 'project' },
      current_node: 'inspect',
    })
    expect(second.id).toBe('route-002')

    const routes = await listWaypointRoutes(projectRoot)
    expect(routes.map((entry) => entry.id)).toEqual(['route-001', 'route-002'])
  })
})
