import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RecipeCard } from './RecipeCard'
import type { Recipe } from '../recipe'

const full: Recipe = {
  slug: 'waypoint-code-reviewer', name: 'Code Reviewer',
  description: 'Reviews source files.', prompt: 'You are the reviewer.', tools: ['Read', 'Grep'],
}

describe('RecipeCard', () => {
  it('renders name, slug, description, tools, and prompt', () => {
    render(<RecipeCard recipe={full} slug={full.slug} />)
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(screen.getByText('waypoint-code-reviewer')).toBeInTheDocument()
    expect(screen.getByText('Reviews source files.')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText('You are the reviewer.')).toBeInTheDocument()
  })

  it('falls back to slug for an empty name and shows absence copy for missing fields', () => {
    render(<RecipeCard recipe={{ slug: 'bare', name: '' }} slug="bare" />)
    expect(screen.getByRole('heading', { name: 'bare' })).toBeInTheDocument()
    expect(screen.getByText('No description')).toBeInTheDocument()
    expect(screen.getByText('No tool grants')).toBeInTheDocument()
    expect(screen.getByText('No prompt defined.')).toBeInTheDocument()
  })

  it('renders a not-found message when the recipe is undefined and not loading', () => {
    render(<RecipeCard recipe={undefined} slug="ghost" />)
    expect(screen.getByText(/not found in the loaded catalog/)).toBeInTheDocument()
    expect(screen.getByText('ghost')).toBeInTheDocument()
  })

  it('shows a loading message (not "not found") while the catalog is still loading', () => {
    render(<RecipeCard recipe={undefined} slug="pending" loading />)
    expect(screen.getByText(/Loading recipe/)).toBeInTheDocument()
    expect(screen.queryByText(/not found in the loaded catalog/)).not.toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('renders every tool chip even when tool names repeat (stable keys)', () => {
    render(<RecipeCard recipe={{ slug: 'dup', name: 'Dup', tools: ['Read', 'Read', 'Grep'] }} slug="dup" />)
    expect(screen.getAllByText('Read')).toHaveLength(2)
    expect(screen.getByText('Grep')).toBeInTheDocument()
  })
})
