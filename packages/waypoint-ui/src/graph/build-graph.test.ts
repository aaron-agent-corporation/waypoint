import { describe, expect, it } from 'vitest'

import type { WaypointFolderTask } from '../engine/types'
import { buildRouteGraph } from './build-graph'

function task(partial: Partial<WaypointFolderTask> & { id: string }): WaypointFolderTask {
  return {
    id: partial.id,
    route_id: 'route-001',
    plan_ref: partial.plan_ref ?? partial.id,
    title: partial.title ?? partial.id,
    phase: partial.phase ?? 'execute',
    wave: partial.wave ?? 0,
    kind: partial.kind ?? 'recipe',
    status: partial.status ?? 'open',
    created_at: 't',
    updated_at: 't',
    ...(partial.metadata ? { metadata: partial.metadata } : {}),
  }
}

describe('buildRouteGraph', () => {
  it('orders nodes by wave then id and chains them left-to-right', () => {
    const { nodes, edges } = buildRouteGraph([
      task({ id: 'task-002', wave: 20 }),
      task({ id: 'task-001', wave: 10 }),
    ])
    expect(nodes.map((n) => n.id)).toEqual(['task-001', 'task-002'])
    expect(nodes[0].position.x).toBe(0)
    expect(nodes[1].position.x).toBe(200)
    expect(edges).toEqual([{ id: 'e-task-001-task-002', source: 'task-001', target: 'task-002' }])
    expect(nodes[0].data).toMatchObject({ label: 'task-001', kind: 'recipe', status: 'open' })
  })

  it('adds edges from beads blockers when present', () => {
    const { edges } = buildRouteGraph([
      task({ id: 'task-001', wave: 10 }),
      task({ id: 'task-002', wave: 20, metadata: { beads: { blockers: ['task-001'] } } }),
    ])
    expect(edges.some((e) => e.id === 'b-task-001-task-002')).toBe(true)
  })

  it('returns empty graph for no tasks', () => {
    expect(buildRouteGraph([])).toEqual({ nodes: [], edges: [] })
  })
})
