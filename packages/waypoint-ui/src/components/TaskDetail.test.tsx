import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../store'
import { TaskDetail } from './TaskDetail'
import type { WaypointFolderRoute, WaypointFolderTask } from '../engine/types'
import type { Recipe } from '../recipe'
import { ClientProvider } from '../engine/context'
import { FakeEngineClient } from '../test/fake-client'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('TaskDetail', () => {
  it('renders the selected task fields', () => {
    useStore.setState({
      selectedTaskId: 'task-001',
      tasks: [{ id: 'task-001', route_id: 'route-001', plan_ref: 'execute-slice', title: 'Execute slice', phase: 'execute', wave: 10, kind: 'recipe', status: 'blocked', created_at: 't', updated_at: 't' }],
    })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText('execute-slice')).toBeInTheDocument()
    expect(screen.getByText(/blocked/)).toBeInTheDocument()
    expect(screen.getByText(/recipe/)).toBeInTheDocument()
  })

  it('prompts to select a task when none is selected', () => {
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText(/select a node or recipe/i)).toBeInTheDocument()
  })
})

describe('TaskDetail dispatcher', () => {
  const route: WaypointFolderRoute = { id: 'route-001', quest: 'code-review', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }
  const reviewer: Recipe = { slug: 'reviewer', name: 'Code Reviewer', description: 'Reviews.', prompt: 'Be adversarial.' }
  const recipeTask: WaypointFolderTask = { id: 'task-1', route_id: 'route-001', plan_ref: 'run-reviewer', title: 't', phase: 'x', wave: 0, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't', metadata: { waypoint: { recipe: { slug: 'reviewer' } } } }

  it('shows the placeholder when nothing is selected', () => {
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText(/Select a/)).toBeInTheDocument()
  })

  it('renders the recipe card when a recipe slug is selected', () => {
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [reviewer] }, selectedRecipeSlug: 'reviewer' })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Be adversarial.')).toBeInTheDocument()
  })

  it('falls back to today task fields when a non-recipe task is selected', () => {
    useStore.setState({ tasks: [{ ...recipeTask, kind: 'checkpoint', metadata: {} }], selectedTaskId: 'task-1', selectedRecipeSlug: null })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
  })

  it('shows Loading… (not not-found) when a slug is selected before its cache resolves', () => {
    // Recipe-node slug selected, but the quest cache is not yet populated and the
    // global cache is null → pre-load, so the card must not flash "not found".
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: {}, recipesAll: null, selectedRecipeSlug: 'reviewer' })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText(/Loading recipe/)).toBeInTheDocument()
    expect(screen.queryByText(/not found in the loaded catalog/)).not.toBeInTheDocument()
  })

  it('shows not-found once the cache has resolved without the slug', () => {
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [] }, selectedRecipeSlug: 'ghost' })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText(/not found in the loaded catalog/)).toBeInTheDocument()
  })

  it('does not flash not-found for a quest recipe while only the global list has loaded (P2)', () => {
    // Route selected (quest cache NOT yet loaded) but recipesAll IS loaded. A
    // quest recipe must show Loading, not a premature "not found".
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: {}, recipesAll: [], selectedRecipeSlug: 'reviewer' })
    render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText(/Loading recipe/)).toBeInTheDocument()
    expect(screen.queryByText(/not found in the loaded catalog/)).not.toBeInTheDocument()
  })

  it('clears the prior task header when a rail recipe is selected after a node', () => {
    const recipeTaskFixture: WaypointFolderTask = { id: 'task-1', route_id: 'route-001', plan_ref: 'run-reviewer', title: 't', phase: 'x', wave: 0, kind: 'recipe', status: 'open', created_at: 't', updated_at: 't', metadata: { waypoint: { recipe: { slug: 'reviewer' } } } }
    useStore.setState({ routes: [route], selectedRouteId: 'route-001', recipesByQuest: { 'code-review': [reviewer, { slug: 'fixer', name: 'Code Fixer' }] }, tasks: [recipeTaskFixture] })
    useStore.getState().selectTask('task-1')
    const { rerender } = render(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
    useStore.getState().selectRecipe('fixer')
    rerender(<ClientProvider client={new FakeEngineClient()}><TaskDetail /></ClientProvider>)
    expect(screen.queryByText('run-reviewer')).not.toBeInTheDocument()
    expect(screen.getByText('Code Fixer')).toBeInTheDocument()
  })

  it('renders gate Approve/Reject for a gate task and issues gate.decide', async () => {
    const gateRoute = { ...route, current_node: 'human_plan_gate' }
    const gateTask: WaypointFolderTask = { id: 'task-g', route_id: 'route-001', plan_ref: 'human_plan_gate', title: 't', phase: 'x', wave: 0, kind: 'gate', status: 'blocked', created_at: 't', updated_at: 't' }
    const client = new FakeEngineClient()
    useStore.setState({ routes: [gateRoute], selectedRouteId: 'route-001', tasks: [gateTask], selectedTaskId: 'task-g', selectedRecipeSlug: null })
    render(<ClientProvider client={client}><TaskDetail /></ClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      const c = client.calls.find((x) => x.name === 'gate.decide')
      expect(c?.payload).toEqual({ routeId: 'route-001', node: 'human_plan_gate', decision: 'approve' })
    })
  })

  it('gate Reject requires confirm and threads the note', async () => {
    const gateRoute = { ...route, current_node: 'human_plan_gate' }
    const gateTask: WaypointFolderTask = { id: 'task-g', route_id: 'route-001', plan_ref: 'human_plan_gate', title: 't', phase: 'x', wave: 0, kind: 'gate', status: 'blocked', created_at: 't', updated_at: 't' }
    const client = new FakeEngineClient()
    useStore.setState({ routes: [gateRoute], selectedRouteId: 'route-001', tasks: [gateTask], selectedTaskId: 'task-g', selectedRecipeSlug: null })
    render(<ClientProvider client={client}><TaskDetail /></ClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByPlaceholderText('note (optional)'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      const c = client.calls.find((x) => x.name === 'gate.decide')
      expect(c?.payload).toEqual({ routeId: 'route-001', node: 'human_plan_gate', decision: 'reject', note: 'no' })
    })
  })
})
