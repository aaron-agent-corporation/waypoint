import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { RoutesPanel } from './RoutesPanel'
import { ClientProvider } from '../engine/context'
import { FakeEngineClient } from '../test/fake-client'
import type { WaypointFolderRoute } from '../engine/types'
import type { Recipe } from '../recipe'
import { useStore } from '../store'

function renderPanel() {
  return render(<ClientProvider client={new FakeEngineClient()}><RoutesPanel /></ClientProvider>)
}

const route = (id: string, quest: string): WaypointFolderRoute => ({
  id, quest, status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't',
})
const reviewer: Recipe = { slug: 'reviewer', name: 'Code Reviewer' }
const fixer: Recipe = { slug: 'fixer', name: 'Code Fixer' }
const global1: Recipe = { slug: 'global-1', name: 'Global One' }

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('RoutesPanel recipes section', () => {
  it('lists the selected route quest recipes in route scope', () => {
    useStore.setState({
      routes: [route('route-001', 'code-review')],
      selectedRouteId: 'route-001',
      recipesByQuest: { 'code-review': [reviewer, fixer] },
    })
    renderPanel()
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Fixer')).toBeInTheDocument()
  })

  it('toggling to All switches the scope and lists the global recipes', () => {
    useStore.setState({ recipesAll: [global1] })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(useStore.getState().recipeScope).toBe('all')
    expect(screen.getByText('Global One')).toBeInTheDocument()
  })

  it('selecting a recipe row sets the slug', () => {
    useStore.setState({
      routes: [route('route-001', 'code-review')], selectedRouteId: 'route-001',
      recipesByQuest: { 'code-review': [reviewer] },
    })
    renderPanel()
    fireEvent.click(screen.getByText('Code Reviewer'))
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
  })

  it('shows the unreadable warning note only in All scope', () => {
    useStore.setState({ recipeScope: 'all', recipesAll: [global1], recipesWarningsAll: ['a.yaml: invalid', 'b.yaml: invalid'] })
    renderPanel()
    expect(screen.getByText('⚠ 2 unreadable')).toBeInTheDocument()
  })

  it('shows the no-route empty state in route scope with no route selected', () => {
    renderPanel()
    expect(screen.getByText('Select a route to see its recipes.')).toBeInTheDocument()
  })

  it('shows "No recipes in the catalog." in All scope when recipesAll is empty', () => {
    useStore.setState({ recipeScope: 'all', recipesAll: [] })
    renderPanel()
    expect(screen.getByText('No recipes in the catalog.')).toBeInTheDocument()
  })

  it('shows a route-scope loading state while the quest fetch is pending', () => {
    useStore.setState({ routes: [route('route-001', 'code-review')], selectedRouteId: 'route-001', recipesByQuest: {} })
    renderPanel()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows a recovery prompt (not a stuck "Loading…") when the fetch errored and the cache is empty', () => {
    useStore.setState({ routes: [route('route-001', 'code-review')], selectedRouteId: 'route-001', recipesByQuest: {}, recipesError: 'catalog blew up' })
    renderPanel()
    expect(screen.getByText(/Couldn't load recipes/)).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})

describe('RoutesPanel Pause/Resume', () => {
  it('shows Pause for an active route and issues run.pause', async () => {
    const client = new FakeEngineClient()
    useStore.setState({ routes: [route('route-1', 'q')] })
    render(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(client.calls.some((c) => c.name === 'run.pause' && (c.payload as { routeId: string }).routeId === 'route-1')).toBe(true))
  })

  it('shows Resume for a blocked route with paused-provenance, and neither for a gate-blocked route', () => {
    const blocked = { ...route('route-2', 'q'), status: 'blocked' as const }
    useStore.setState({
      routes: [blocked],
      routeEventsByRoute: { 'route-2': [{ id: '1', route_id: 'route-2', kind: 'route.paused', created_at: 't' } as never] },
    })
    const client = new FakeEngineClient()
    const { rerender } = render(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()

    // gate-blocked (no pause events) → neither Pause nor Resume
    useStore.setState({ routeEventsByRoute: { 'route-2': [{ id: '1', route_id: 'route-2', kind: 'route.started', created_at: 't' } as never] } })
    rerender(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })
})

describe('RoutesPanel routes/sessions', () => {
  it('lists routes and sessions and selects on click', async () => {
    useStore.setState({
      routes: [{ id: 'route-001', quest: 'waypoint', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
      sessions: [{ id: 'agent-001', intent: 'build a recipe', status: 'completed', startedAt: 't' }],
    })
    renderPanel()
    expect(screen.getByText(/route-001/)).toBeInTheDocument()
    expect(screen.getByText(/build a recipe/)).toBeInTheDocument()

    await userEvent.click(screen.getByText(/route-001/))
    expect(useStore.getState().selectedRouteId).toBe('route-001')
    await userEvent.click(screen.getByText(/build a recipe/))
    expect(useStore.getState().activeSessionId).toBe('agent-001')
  })
})
