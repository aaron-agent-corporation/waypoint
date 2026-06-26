import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../store'
import { TaskDetail } from './TaskDetail'
import type { WaypointFolderRoute, WaypointFolderTask } from '../engine/types'
import type { Recipe } from '../recipe'

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
    expect(screen.getByText(/select a node or recipe/i)).toBeInTheDocument()
  })
})

describe('TaskDetail dispatcher', () => {
  const route: WaypointFolderRoute = { id: 'route-001', quest: 'code-review', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }
  const reviewer: Recipe = { slug: 'reviewer', name: 'Code Reviewer', description: 'Reviews.', prompt: 'Be adversarial.' }
  const recipeTask: WaypointFolderTask = { id: 'task-1', route_id: 'route-001', plan_ref: 'run-reviewer', title: 't', phase: 'x', wave: 0, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't', metadata: { waypoint: { recipe: { slug: 'reviewer' } } } }

  it('shows the placeholder when nothing is selected', () => {
    render(<TaskDetail />)
    expect(screen.getByText(/Select a/)).toBeInTheDocument()
  })

  it('renders the recipe card when a recipe slug is selected', () => {
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [reviewer] }, selectedRecipeSlug: 'reviewer' })
    render(<TaskDetail />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Be adversarial.')).toBeInTheDocument()
  })

  it('falls back to today task fields when a non-recipe task is selected', () => {
    useStore.setState({ tasks: [{ ...recipeTask, kind: 'checkpoint', metadata: {} }], selectedTaskId: 'task-1', selectedRecipeSlug: null })
    render(<TaskDetail />)
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
  })

  it('clears the prior task header when a rail recipe is selected after a node', () => {
    const recipeTaskFixture: WaypointFolderTask = { id: 'task-1', route_id: 'route-001', plan_ref: 'run-reviewer', title: 't', phase: 'x', wave: 0, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't', metadata: { waypoint: { recipe: { slug: 'reviewer' } } } }
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [reviewer, { slug: 'fixer', name: 'Code Fixer' }] }, tasks: [recipeTaskFixture] })
    useStore.getState().selectTask('task-1')
    const { rerender } = render(<TaskDetail />)
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
    useStore.getState().selectRecipe('fixer')
    rerender(<TaskDetail />)
    expect(screen.queryByText('run-reviewer')).not.toBeInTheDocument()
    expect(screen.getByText('Code Fixer')).toBeInTheDocument()
  })
})
