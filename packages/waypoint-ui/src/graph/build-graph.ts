import type { WaypointFolderTask, WaypointFolderTaskKind, WaypointFolderTaskStatus } from '../engine/types'

export interface RouteGraphNode {
  id: string
  position: { x: number; y: number }
  data: { label: string; kind: WaypointFolderTaskKind; status: WaypointFolderTaskStatus }
}

export interface RouteGraphEdge {
  id: string
  source: string
  target: string
}

export function buildRouteGraph(tasks: readonly WaypointFolderTask[]): { nodes: RouteGraphNode[]; edges: RouteGraphEdge[] } {
  const sorted = [...tasks].sort((a, b) => (a.wave ?? 0) - (b.wave ?? 0) || a.id.localeCompare(b.id))

  const nodes: RouteGraphNode[] = sorted.map((t, i) => ({
    id: t.id,
    position: { x: i * 200, y: 0 },
    data: { label: t.plan_ref, kind: t.kind, status: t.status },
  }))

  const edges: RouteGraphEdge[] = []
  for (let i = 1; i < sorted.length; i += 1) {
    edges.push({ id: `e-${sorted[i - 1].id}-${sorted[i].id}`, source: sorted[i - 1].id, target: sorted[i].id })
  }
  for (const t of sorted) {
    const beads = isRecord(t.metadata) && isRecord(t.metadata.beads) ? t.metadata.beads : undefined
    const blockers = beads && Array.isArray(beads.blockers) ? beads.blockers : []
    for (const b of blockers) {
      if (typeof b !== 'string') continue
      const id = `b-${b}-${t.id}`
      if (!edges.some((e) => e.id === id)) edges.push({ id, source: b, target: t.id })
    }
  }
  return { nodes, edges }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
