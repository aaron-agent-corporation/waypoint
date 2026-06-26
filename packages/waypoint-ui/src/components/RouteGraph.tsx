import { useCallback, useMemo } from 'react'
import { Background, Controls, ReactFlow } from '@xyflow/react'

import { GraphNode } from './GraphNode'
import { buildRouteGraph } from '../graph/build-graph'
import { resolveRecipe } from '../recipe'
import { useStore } from '../store'

const nodeTypes = { recipeAware: GraphNode }

export function RouteGraph() {
  const selectedRouteId = useStore((s) => s.selectedRouteId)
  const tasks = useStore((s) => s.tasks)
  const routes = useStore((s) => s.routes)
  const recipesByQuest = useStore((s) => s.recipesByQuest)
  const recipesAll = useStore((s) => s.recipesAll)
  const selectTask = useStore((s) => s.selectTask)

  const routeTasks = useMemo(() => tasks.filter((t) => t.route_id === selectedRouteId), [tasks, selectedRouteId])
  const quest = routes.find((r) => r.id === selectedRouteId)?.quest
  const resolver = useCallback(
    (slug: string) => resolveRecipe(slug, quest, { recipesByQuest, recipesAll })?.name,
    [quest, recipesByQuest, recipesAll],
  )
  const { nodes, edges } = useMemo(() => buildRouteGraph(routeTasks, resolver), [routeTasks, resolver])

  if (!selectedRouteId) return <div style={{ padding: 16 }}>Select a route to view its DAG.</div>

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView onNodeClick={(_e, node) => selectTask(node.id)}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
