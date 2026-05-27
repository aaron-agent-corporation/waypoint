import { describe, expect, it } from 'vitest'

import { createWaypointProjectConfig, parseWaypointProjectConfig, serializeWaypointProjectConfig } from './config.ts'

describe('Waypoint project config', () => {
  it('defaults existing configs to the folder route backend', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: waypoint
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.backend).toEqual({ route: 'folder' })
  })

  it('round-trips the Beads route backend without changing recipe runtime config', () => {
    const config = createWaypointProjectConfig({
      quest: 'waypoint',
      backend: 'beads',
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(parseWaypointProjectConfig(serializeWaypointProjectConfig(config))).toMatchObject({
      quest: 'waypoint',
      backend: { route: 'beads' },
      runtime: { recipe: null },
    })
  })
})
