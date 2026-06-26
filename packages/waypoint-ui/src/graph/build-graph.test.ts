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

  it('drops a blocker edge whose source is not a task in this route', () => {
    const { edges } = buildRouteGraph([
      task({ id: 'task-001', wave: 10, metadata: { beads: { blockers: ['task-elsewhere'] } } }),
    ])
    expect(edges.some((e) => e.source === 'task-elsewhere')).toBe(false)
  })

  it('returns empty graph for no tasks', () => {
    expect(buildRouteGraph([])).toEqual({ nodes: [], edges: [] })
  })
})

const base = { route_id: 'route-001', title: 't', phase: 'x', created_at: 't', updated_at: 't' }
const recipeTask: WaypointFolderTask = { ...base, id: 'task-1', plan_ref: 'run-reviewer', wave: 0, kind: 'recipe', status: 'open', metadata: { waypoint: { recipe: { slug: 'reviewer' } } } }
const checkpointTask: WaypointFolderTask = { ...base, id: 'task-2', plan_ref: 'intake', wave: 1, kind: 'checkpoint', status: 'open', metadata: {} }

describe('buildRouteGraph enrichment', () => {
  it('badges a recipe node "recipe" and resolves its name subtitle', () => {
    const { nodes } = buildRouteGraph([recipeTask], (slug) => (slug === 'reviewer' ? 'Code Reviewer' : undefined))
    const n = nodes.find((x) => x.id === 'task-1')!
    expect(n.data.badge).toBe('recipe')
    expect(n.data.recipeName).toBe('Code Reviewer')
    expect(n.type).toBe('recipeAware')
  })

  it('falls back to the slug when the resolver returns undefined', () => {
    const { nodes } = buildRouteGraph([recipeTask])
    expect(nodes.find((x) => x.id === 'task-1')!.data.recipeName).toBe('reviewer')
  })

  it('badges a non-recipe node with its verbatim kind and no recipe name', () => {
    const { nodes } = buildRouteGraph([checkpointTask])
    const n = nodes.find((x) => x.id === 'task-2')!
    expect(n.data.badge).toBe('checkpoint')
    expect(n.data.recipeName).toBeUndefined()
  })
})
