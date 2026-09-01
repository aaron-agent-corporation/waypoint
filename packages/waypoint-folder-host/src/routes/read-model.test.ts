import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import { PostgresTestProjects } from '../testing/postgres'
import { createWaypointRoute } from './store'
import { listWaypointRuntimeRoutes } from './read-model'

const pgProjects = new PostgresTestProjects()

describe('Waypoint route read model', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })

  it('lists runtime routes from the postgres-backed store', async () => {
    const projectRoot = await pgProjects.mkProjectRoot('runner-read-model-')
    await initWaypointProject(projectRoot, { quest: 'runner' })
    await createWaypointRoute(projectRoot, {
      id: 'route-123',
      quest: 'runner',
      subject: { type: 'project', id: 'local' },
      current_node: 'initialize',
    })

    await expect(listWaypointRuntimeRoutes(projectRoot)).resolves.toMatchObject([
      { id: 'route-123', quest: 'runner', current_node: 'initialize' },
    ])
  })
})
