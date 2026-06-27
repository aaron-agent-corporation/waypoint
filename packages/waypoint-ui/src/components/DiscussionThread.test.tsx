import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { DiscussionThread } from './DiscussionThread'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

const page = (items: { id: string; author: string; content: string }[]) => ({
  ok: true, action: 'discuss.list', discussion: { task_id: 'task-d', total: items.length, items },
})

describe('DiscussionThread', () => {
  it('fetches and renders messages on mount', async () => {
    const client = new FakeEngineClient()
    client.responses['discuss.list'] = page([{ id: 'm1', author: 'agent', content: 'first message' }]) as never
    render(<ClientProvider client={client}><DiscussionThread taskId="task-d" /></ClientProvider>)
    expect(await screen.findByText('first message')).toBeInTheDocument()
    expect(client.calls.find((c) => c.name === 'discuss.list')?.payload).toEqual({ taskId: 'task-d' })
  })

  it('posts a message with no author field and refetches', async () => {
    const client = new FakeEngineClient()
    client.responses['discuss.list'] = page([]) as never
    client.responses['discuss.post'] = { ok: true, action: 'discuss.post', message: { id: 'm2' } } as never
    render(<ClientProvider client={client}><DiscussionThread taskId="task-d" /></ClientProvider>)
    await waitFor(() => expect(client.calls.some((c) => c.name === 'discuss.list')).toBe(true))
    fireEvent.change(screen.getByPlaceholderText('Add a message…'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => {
      const c = client.calls.find((x) => x.name === 'discuss.post')
      expect(c?.payload).toEqual({ taskId: 'task-d', message: 'hello' })
    })
    expect(client.calls.filter((c) => c.name === 'discuss.list').length).toBeGreaterThanOrEqual(2) // refetched
  })
})
