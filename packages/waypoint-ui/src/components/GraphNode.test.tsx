import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GraphNode } from './GraphNode'

describe('GraphNode', () => {
  it('renders the badge, label, and recipe-name subtitle', () => {
    render(<GraphNode data={{ label: 'run-reviewer', kind: 'recipe', status: 'open', badge: 'recipe', recipeName: 'Code Reviewer' }} />)
    expect(screen.getByText('recipe')).toBeInTheDocument()
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
  })

  it('omits the subtitle when there is no recipe name', () => {
    render(<GraphNode data={{ label: 'intake', kind: 'checkpoint', status: 'open', badge: 'checkpoint' }} />)
    expect(screen.getByText('intake')).toBeInTheDocument()
    expect(screen.queryByText('Code Reviewer')).not.toBeInTheDocument()
  })
})
