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

  it('parses optional Gas City runtime host config without making it a route backend', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: waypoint
backend:
  route: beads
runtime:
  recipe: null
  gascity:
    enabled: true
    city: /tmp/gascity
    rig: waypoint
    target: waypoint/codex
    provider: codex
    auto_start: false
    sling:
      mode: route-root
      no_formula: true
      nudge: true
    repair_policy:
      route_metadata: report-only
      stranded_assignment: report-only
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.backend).toEqual({ route: 'beads' })
    expect(config.runtime.gascity).toEqual({
      enabled: true,
      city: '/tmp/gascity',
      rig: 'waypoint',
      target: 'waypoint/codex',
      provider: 'codex',
      auto_start: false,
      sling: {
        mode: 'route-root',
        no_formula: true,
        nudge: true,
      },
      repair_policy: {
        route_metadata: 'report-only',
        stranded_assignment: 'report-only',
      },
    })
  })
})
