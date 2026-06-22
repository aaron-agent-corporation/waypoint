import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { useStore } from '../store'
import { FakeEngineClient } from '../test/fake-client'
import { AgentChat } from './AgentChat'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function renderChat(client: FakeEngineClient) {
  return render(
    <ClientProvider client={client}>
      <AgentChat />
    </ClientProvider>,
  )
}

describe('AgentChat', () => {
  it('authors a session on submit, then renders streamed transcript events', async () => {
    const client = new FakeEngineClient()
    client.responses['agent.author'] = { ok: true, action: 'agent.author', sessionId: 'agent-001', status: 'running' }
    renderChat(client)
    client.subscribe(['*'], useStore.getState().applyMessage)

    await userEvent.type(screen.getByPlaceholderText(/describe what to build/i), 'Add a lint recipe')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(useStore.getState().activeSessionId).toBe('agent-001'))
    expect(client.calls.find((c) => c.name === 'agent.author')).toMatchObject({ payload: { intent: 'Add a lint recipe' } })

    // Stream an assistant message then a terminal result for the active session.
    client.emit({ type: 'event', topic: 'agent:agent-001', seq: 1, record: { id: 'e1', sessionId: 'agent-001', kind: 'agent.message', at: 't', idx: 0, data: { text: 'drafting' } } })
    client.emit({ type: 'event', topic: 'agent:agent-001', seq: 2, record: { id: 'e2', sessionId: 'agent-001', kind: 'agent.tool_result', at: 't', idx: 1, data: { toolName: 'waypoint_author_promote', text: '{"proposalId":"recipe/demo"}' } } })

    expect(await screen.findByText(/drafting/)).toBeInTheDocument()
    expect(await screen.findByText(/recipe\/demo/)).toBeInTheDocument()
  })

  it('cancels the active session', async () => {
    const client = new FakeEngineClient()
    useStore.setState({ activeSessionId: 'agent-007', transcripts: { 'agent-007': [] } })
    renderChat(client)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(client.calls.find((c) => c.name === 'agent.cancel')).toMatchObject({ payload: { sessionId: 'agent-007' } })
  })
})
