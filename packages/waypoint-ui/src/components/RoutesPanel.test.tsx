import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../store'
import { RoutesPanel } from './RoutesPanel'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('RoutesPanel', () => {
  it('lists routes and sessions and selects on click', async () => {
    useStore.setState({
      routes: [{ id: 'route-001', quest: 'waypoint', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
      sessions: [{ id: 'agent-001', intent: 'build a recipe', status: 'completed', startedAt: 't' }],
    })
    render(<RoutesPanel />)
    expect(screen.getByText(/route-001/)).toBeInTheDocument()
    expect(screen.getByText(/build a recipe/)).toBeInTheDocument()

    await userEvent.click(screen.getByText(/route-001/))
    expect(useStore.getState().selectedRouteId).toBe('route-001')
    await userEvent.click(screen.getByText(/build a recipe/))
    expect(useStore.getState().activeSessionId).toBe('agent-001')
  })
})
