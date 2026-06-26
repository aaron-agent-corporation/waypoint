import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { RoutesPanel } from './RoutesPanel'
import type { WaypointFolderRoute } from '../engine/types'
import type { Recipe } from '../recipe'
import { useStore } from '../store'

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
    render(<RoutesPanel />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Fixer')).toBeInTheDocument()
  })

  it('toggling to All switches the scope and lists the global recipes', () => {
    useStore.setState({ recipesAll: [global1] })
    render(<RoutesPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(useStore.getState().recipeScope).toBe('all')
    expect(screen.getByText('Global One')).toBeInTheDocument()
  })

  it('selecting a recipe row sets the slug', () => {
    useStore.setState({
      routes: [route('route-001', 'code-review')], selectedRouteId: 'route-001',
      recipesByQuest: { 'code-review': [reviewer] },
    })
    render(<RoutesPanel />)
    fireEvent.click(screen.getByText('Code Reviewer'))
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
  })

  it('shows the unreadable warning note only in All scope', () => {
    useStore.setState({ recipeScope: 'all', recipesAll: [global1], recipesWarningsAll: ['a.yaml: invalid', 'b.yaml: invalid'] })
    render(<RoutesPanel />)
    expect(screen.getByText('⚠ 2 unreadable')).toBeInTheDocument()
  })

  it('shows the no-route empty state in route scope with no route selected', () => {
    render(<RoutesPanel />)
    expect(screen.getByText('Select a route to see its recipes.')).toBeInTheDocument()
  })
})
