import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  parseHermesProjectRegistry,
  resolveHermesProject,
  type HermesProjectRegistry,
} from './project-registry.ts'

describe('Hermes project registry', () => {
  it('parses trusted project names into absolute project paths and CLI entrypoints', () => {
    const registry = parseHermesProjectRegistry(`
projects:
  waypoint:
    path: /Users/aaronwhaley/Github/waypoint
    waypoint_cli: /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts
  perry:
    path: /Users/aaronwhaley/Github/perry
`)

    expect(registry.projects.waypoint).toEqual({
      name: 'waypoint',
      path: '/Users/aaronwhaley/Github/waypoint',
      waypointCli: '/Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts',
    })
    expect(registry.projects.perry).toEqual({
      name: 'perry',
      path: '/Users/aaronwhaley/Github/perry',
      waypointCli: resolve('/Users/aaronwhaley/Github/perry', 'packages/waypoint-cli/src/bin.ts'),
    })
  })

  it('rejects unknown project names instead of treating natural language as a path', () => {
    const registry: HermesProjectRegistry = {
      projects: {
        waypoint: {
          name: 'waypoint',
          path: '/Users/aaronwhaley/Github/waypoint',
          waypointCli: '/Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts',
        },
      },
    }

    expect(resolveHermesProject(registry, 'waypoint').path).toBe('/Users/aaronwhaley/Github/waypoint')
    expect(() => resolveHermesProject(registry, '../waypoint')).toThrow('Unknown Hermes Waypoint project: ../waypoint')
    expect(() => resolveHermesProject(registry, '/Users/aaronwhaley/Github/waypoint')).toThrow(
      'Unknown Hermes Waypoint project: /Users/aaronwhaley/Github/waypoint',
    )
  })

  it('requires project keys and paths to be explicit and safe', () => {
    expect(() =>
      parseHermesProjectRegistry(`
projects:
  '../waypoint':
    path: /Users/aaronwhaley/Github/waypoint
`),
    ).toThrow('Invalid Hermes project name: ../waypoint')

    expect(() =>
      parseHermesProjectRegistry(`
projects:
  waypoint:
    path: relative/path
`),
    ).toThrow('Hermes project waypoint path must be absolute')

    expect(() =>
      parseHermesProjectRegistry(`
projects:
  waypoint:
    path: /Users/aaronwhaley/Github/waypoint
    waypoint_cli: relative/bin.ts
`),
    ).toThrow('Hermes project waypoint waypoint_cli must be absolute')
  })
})
