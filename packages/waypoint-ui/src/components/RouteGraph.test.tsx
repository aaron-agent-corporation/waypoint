import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore } from '../store'
import { RouteGraph } from './RouteGraph'

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string; data: { label: string } }[] }) => (
    <div data-testid="rf">{nodes.map((n) => <span key={n.id}>{n.data.label}</span>)}</div>
  ),
  Background: () => null,
  Controls: () => null,
}))

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('RouteGraph', () => {
  it('renders nodes for the selected route only', () => {
    useStore.setState({
      selectedRouteId: 'route-001',
      tasks: [
        { id: 'task-001', route_id: 'route-001', plan_ref: 'execute-slice', title: 't', phase: 'execute', wave: 10, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't' },
        { id: 'task-099', route_id: 'route-002', plan_ref: 'other', title: 't', phase: 'execute', wave: 10, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't' },
      ],
    })
    render(<RouteGraph />)
    expect(screen.getByText('execute-slice')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })

  it('shows an empty hint when no route is selected', () => {
    render(<RouteGraph />)
    expect(screen.getByText(/select a route/i)).toBeInTheDocument()
  })
})
