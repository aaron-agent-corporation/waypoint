import { Handle, Position } from '@xyflow/react'

import type { RouteGraphNode } from '../graph/build-graph'

export function GraphNode({ data }: { data: RouteGraphNode['data'] }) {
  return (
    <div style={{ border: '1px solid #999', borderRadius: 4, padding: '4px 8px', background: '#fff', fontSize: 12, minWidth: 80 }}>
      <Handle type="target" position={Position.Left} />
      <div>
        <span style={{ background: '#eee', borderRadius: 3, padding: '0 4px', marginRight: 4 }}>{data.badge}</span>
        {data.label}
      </div>
      {data.recipeName ? <div style={{ color: '#666', fontSize: 11 }}>{data.recipeName}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
