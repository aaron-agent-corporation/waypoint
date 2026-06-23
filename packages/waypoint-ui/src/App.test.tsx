import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { useStore } from './store'
import { FakeEngineClient } from './test/fake-client'

const route = (id: string) => ({ id, quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' })

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

  it('surfaces a refetch failure in a visible error banner', async () => {
    const client = new FakeEngineClient()
    client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
    client.responses['agent.list'] = { ok: false, action: 'agent.list', error: 'engine unreachable' } as never

    render(<App client={client} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('engine unreachable')
  })

  it('retries a failing routes refresh (bounded) and applies + clears the banner on eventual success', async () => {
    vi.useFakeTimers()
    try {
      let routesCalls = 0
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [] }
      const baseCmd = client.cmd.bind(client)
      client.cmd = (async (name: string, payload?: unknown) => {
        if (name === 'routes.list') {
          routesCalls += 1
          return routesCalls <= 2
            ? { ok: false, action: 'routes.list', error: 'flaky' }
            : { ok: true, action: 'routes.list', routes: [route('route-xyz')] }
        }
        if (name === 'tasks.list') return { ok: true, action: 'tasks.list', tasks: [] }
        return baseCmd(name, payload)
      }) as never

      render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // open the gate

      // A route event bumps the epoch → routes refetch begins (and fails twice).
      act(() => client.emit({ type: 'event', topic: 'route:route-xyz', seq: 1, record: { kind: 'route.started' } }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(routesCalls).toBe(1)
      expect(screen.getByRole('alert')).toHaveTextContent('flaky')

      await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) // retry 1 — still fails
      expect(routesCalls).toBe(2)

      await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) // retry 2 — succeeds
      expect(routesCalls).toBe(3)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(useStore.getState().routes.map((r) => r.id)).toContain('route-xyz')
    } finally {
      vi.useRealTimers()
    }
  })
})
