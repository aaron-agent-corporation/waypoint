import { useMemo } from 'react'
import { Background, Controls, ReactFlow } from '@xyflow/react'

import { buildRouteGraph } from '../graph/build-graph'
import { useStore } from '../store'

export function RouteGraph() {
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)

  const routeTasks = useMemo(
    () => tasks.filter((t) => t.route_id === selectedRouteId),
    [tasks, selectedRouteId],
  )
  const { nodes, edges } = useMemo(() => buildRouteGraph(routeTasks), [routeTasks])

  if (!selectedRouteId) return <div style={{ padding: 16 }}>Select a route to view its DAG.</div>

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_e, node) => selectTask(node.id)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
