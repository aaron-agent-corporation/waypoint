import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../store'
import { TaskDetail } from './TaskDetail'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('TaskDetail', () => {
  it('renders the selected task fields', () => {
    useStore.setState({
      selectedTaskId: 'task-001',
      tasks: [{ id: 'task-001', route_id: 'route-001', plan_ref: 'execute-slice', title: 'Execute slice', phase: 'execute', wave: 10, kind: 'recipe', status: 'blocked', created_at: 't', updated_at: 't' }],
    })
    render(<TaskDetail />)
    expect(screen.getByText('execute-slice')).toBeInTheDocument()
    expect(screen.getByText(/blocked/)).toBeInTheDocument()
    expect(screen.getByText(/recipe/)).toBeInTheDocument()
  })

  it('prompts to select a task when none is selected', () => {
    render(<TaskDetail />)
    expect(screen.getByText(/select a task/i)).toBeInTheDocument()
  })
})
