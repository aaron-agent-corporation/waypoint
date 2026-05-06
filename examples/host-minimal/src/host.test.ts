/**
 * Minimal host portability proof (M5.1).
 *
 * This file MUST import only from '@waypoint/core'. It must not import
 * from '@/lib/...' or any Mission Control module. That constraint is
 * what proves portability.
 */

import { describe, expect, it } from 'vitest'
import { runMinimalWaypointHostScenario } from './host'

describe('examples/waypoint-host-minimal', () => {
  it('parses a waypoint command and starts a route using only @waypoint/core', async () => {
    const result = await runMinimalWaypointHostScenario({
      command: '/waypoint start plan --plan-id 42',
      actor: { id: 1, role: 'operator', workspaceId: 1, tenantId: 1 },
      projectId: 7,
    })

    expect(result.parsed).toMatchObject({
      name: 'start',
      target: 'plan',
      planId: 42,
      definitionSlug: 'waypoint-plan-execution',
      definitionVersion: 1,
    })
    expect(result.routeKey).toBe('waypoint:waypoint_plan:42:waypoint-plan-execution:v1')
    expect(result.route).toMatchObject({
      projectId: 7,
      subjectType: 'waypoint_plan',
      subjectId: 42,
      status: 'active',
    })
    expect(result.listedRoutes.items).toHaveLength(1)
    expect(result.listedRoutes.total).toBe(1)
    expect(result.events.some((e) => e.type === 'waypoint.route.started')).toBe(true)
  })

  it('returns a normalized error envelope for malformed commands via core helpers', async () => {
    const result = await runMinimalWaypointHostScenario({
      command: '/waypoint start plan',
      actor: { id: 1, role: 'operator', workspaceId: 1, tenantId: 1 },
      projectId: 7,
    })

    expect(result.error).toEqual({
      ok: false,
      action: 'error',
      error: 'Missing or invalid --plan-id',
    })
  })
})
