import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { GraphNode } from './GraphNode'

describe('GraphNode', () => {
  it('renders the badge, label, and recipe-name subtitle', () => {
    const { container } = render(
      <ReactFlowProvider>
        <GraphNode data={{ label: 'run-reviewer', kind: 'recipe', status: 'open', badge: 'recipe', recipeName: 'Code Reviewer' }} />
      </ReactFlowProvider>
    )
    expect(screen.getByText('recipe')).toBeInTheDocument()
    expect(screen.getByText('run-reviewer')).toBeInTheDocument()
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument()
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(2)
  })

  it('omits the subtitle when there is no recipe name', () => {
    render(
      <ReactFlowProvider>
        <GraphNode data={{ label: 'intake', kind: 'checkpoint', status: 'open', badge: 'checkpoint' }} />
      </ReactFlowProvider>
    )
    expect(screen.getByText('intake')).toBeInTheDocument()
    expect(screen.queryByText('Code Reviewer')).not.toBeInTheDocument()
  })
})
