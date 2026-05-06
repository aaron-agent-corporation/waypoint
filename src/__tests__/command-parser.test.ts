import { describe, expect, it } from 'vitest'
import { parseWaypointCommand } from '../commands/parser'

describe('waypoint-core contract: command parser', () => {
  it('parses bare status command', () => {
    expect(parseWaypointCommand('/waypoint status')).toMatchObject({
      name: 'status',
    })
  })

  it('parses auto status with pagination (offset=0 allowed)', () => {
    expect(parseWaypointCommand('/waypoint auto status --limit 25 --offset 0')).toEqual({
      name: 'auto_status',
      limit: 25,
      offset: 0,
    })
  })

  it('parses bounded autopilot with max-iterations', () => {
    expect(parseWaypointCommand('/waypoint auto --max-iterations 5')).toEqual({
      name: 'auto',
      maxIterations: 5,
    })
  })

  it('parses gate approve with optional note', () => {
    expect(
      parseWaypointCommand('/waypoint gate --route-id 42 --node human_acceptance --approve --note looks good'),
    ).toEqual({
      name: 'gate',
      routeId: 42,
      nodeKey: 'human_acceptance',
      decision: 'approve',
      note: 'looks good',
    })
  })

  it('parses gate reject without note', () => {
    expect(
      parseWaypointCommand('/waypoint gate --route-id 7 --node review_gate --reject'),
    ).toEqual({
      name: 'gate',
      routeId: 7,
      nodeKey: 'review_gate',
      decision: 'reject',
    })
  })

  it('accepts /wp as command alias', () => {
    expect(parseWaypointCommand('/wp status')).toMatchObject({ name: 'status' })
  })
})
