import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { initWaypointProject } from './init'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-init-'))
}

describe('initWaypointProject', () => {
  it('creates .waypoint config and required state directories', async () => {
    const projectRoot = await tempProject()

    const result = await initWaypointProject(projectRoot, { quest: 'gsd' })

    expect(result.projectRoot).toBe(projectRoot)
    expect(result.waypointDir).toBe(join(projectRoot, '.waypoint'))
    expect(result.config.quest).toBe('gsd')
    expect(result.config.enabled).toBe(true)

    const configText = await readFile(join(projectRoot, '.waypoint/config.yaml'), 'utf8')
    const config = yamlParse(configText) as Record<string, unknown>

    expect(config).toMatchObject({
      schema_version: 1,
      enabled: true,
      quest: 'gsd',
      runtime: { recipe: null },
    })
    expect(typeof config.created_at).toBe('string')
    expect(typeof config.updated_at).toBe('string')

    for (const relativePath of [
      '.waypoint/quests',
      '.waypoint/recipes',
      '.waypoint/lifecycle',
      '.waypoint/routes',
      '.waypoint/events',
      '.waypoint/tasks',
    ]) {
      const entry = await stat(join(projectRoot, relativePath))
      expect(entry.isDirectory()).toBe(true)
    }
  })
})
