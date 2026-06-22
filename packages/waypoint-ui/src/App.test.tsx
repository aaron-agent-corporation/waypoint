import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { useStore } from './store'
import { FakeEngineClient } from './test/fake-client'

vi.mock('@xyflow/react', () => ({
  ReactFlow: () => <div data-testid="rf" />,
  Background: () => null,
  Controls: () => null,
}))

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

describe('App', () => {
  it('gates on workspace, then renders the three panes and hydrates from the snapshot', async () => {
    const client = new FakeEngineClient()
    client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
    client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [{ id: 'agent-001', intent: 'demo', status: 'running', startedAt: 't' }] }

    render(<App client={client} />)

    // Console mounts → subscribe registered → emit a snapshot.
    await waitFor(() => expect(screen.getByText('Routes')).toBeInTheDocument())
    client.emit({
      type: 'snapshot',
      apiVersion: '1',
      seq: 1,
      routes: [{ id: 'route-001', quest: 'waypoint', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
      tasks: [],
    })

    expect(await screen.findByText('route-001 · active')).toBeInTheDocument()
    expect(await screen.findByText(/demo/)).toBeInTheDocument()
  })
})
