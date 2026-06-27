import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmAction } from './ConfirmAction'

describe('ConfirmAction', () => {
  it('fires onConfirm only after the confirm step', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Start" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancel reverts without firing', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Reject" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('threads the note value into onConfirm when withNote', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Reject" withNote onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByPlaceholderText('note (optional)'), { target: { value: 'bad plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledWith('bad plan')
  })
})
