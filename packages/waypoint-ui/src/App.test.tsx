import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { EngineWsMessage, WaypointFolderRoute } from './engine/types'
import { useStore } from './store'
import { FakeEngineClient } from './test/fake-client'

const route = (id: string): WaypointFolderRoute => ({ id, quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' })

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

  it('clears a routes banner on a later epoch success after the prior epoch exhausted its retries', async () => {
    vi.useFakeTimers()
    try {
      let routesOk = false
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [] }
      const baseCmd = client.cmd.bind(client)
      client.cmd = (async (name: string, payload?: unknown) => {
        if (name === 'routes.list') {
          return routesOk ? { ok: true, action: 'routes.list', routes: [route('route-ok')] } : { ok: false, action: 'routes.list', error: 'down' }
        }
        if (name === 'tasks.list') return { ok: true, action: 'tasks.list', tasks: [] }
        return baseCmd(name, payload)
      }) as never

      render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // open the gate

      // Epoch 1: routes fail through the entire bounded retry (4 attempts @ 0/2/4/6s).
      act(() => client.emit({ type: 'event', topic: 'route:r', seq: 1, record: { kind: 'route.started' } }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByRole('alert')).toHaveTextContent('down')

      // Epoch 2: routes now succeed → the next epoch's success clears the banner.
      routesOk = true
      act(() => client.emit({ type: 'event', topic: 'route:r', seq: 2, record: { kind: 'route.updated' } }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(useStore.getState().routes.map((r) => r.id)).toContain('route-ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-attempts and clears the routes banner when the operator presses Retry after exhaustion', async () => {
    vi.useFakeTimers()
    try {
      let routesOk = false
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [] }
      const baseCmd = client.cmd.bind(client)
      client.cmd = (async (name: string, payload?: unknown) => {
        if (name === 'routes.list')
          return routesOk ? { ok: true, action: 'routes.list', routes: [route('route-retry')] } : { ok: false, action: 'routes.list', error: 'down' }
        if (name === 'tasks.list') return { ok: true, action: 'tasks.list', tasks: [] }
        return baseCmd(name, payload)
      }) as never

      render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // open the gate

      // Epoch 1: routes fail through the entire bounded retry → banner up.
      act(() => client.emit({ type: 'event', topic: 'route:r', seq: 1, record: { kind: 'route.started' } }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByRole('alert')).toHaveTextContent('down')

      // The engine recovers silently (no event). The operator presses Retry → a manual
      // epoch bump → the refetch now succeeds and the banner clears.
      routesOk = true
      act(() => { screen.getByRole('button', { name: 'Retry' }).click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(useStore.getState().routes.map((r) => r.id)).toContain('route-retry')
    } finally {
      vi.useRealTimers()
    }
  })

  it('nudges a stale routes refetch when the session poll recovers (idle recovery, no route event)', async () => {
    vi.useFakeTimers()
    try {
      let agentOk = false
      let routesOk = false
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      const baseCmd = client.cmd.bind(client)
      client.cmd = (async (name: string, payload?: unknown) => {
        if (name === 'agent.list')
          return agentOk ? { ok: true, action: 'agent.list', sessions: [] } : { ok: false, action: 'agent.list', error: 'engine down' }
        if (name === 'routes.list')
          return routesOk ? { ok: true, action: 'routes.list', routes: [route('route-idle')] } : { ok: false, action: 'routes.list', error: 'down' }
        if (name === 'tasks.list') return { ok: true, action: 'tasks.list', tasks: [] }
        return baseCmd(name, payload)
      }) as never

      render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // gate opens; first session poll FAILS

      // Epoch 1: routes also fail through the bounded retry → routes banner up.
      act(() => client.emit({ type: 'event', topic: 'route:r', seq: 1, record: { kind: 'route.started' } }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByText('down')).toBeInTheDocument()

      // The engine recovers but emits NO route event. The next session poll succeeds
      // (error→ok), which nudges the stale routes refetch — which now succeeds.
      agentOk = true
      routesOk = true
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) }) // session poll recovers → epoch bump
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // settle the nudged refetch

      expect(useStore.getState().routes.map((r) => r.id)).toContain('route-idle')
      expect(screen.queryByText('down')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not starve the session poll when agent.list is slower than the poll interval', async () => {
    vi.useFakeTimers()
    try {
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      const baseCmd = client.cmd.bind(client)
      client.cmd = (async (name: string, payload?: unknown) => {
        if (name === 'agent.list') {
          await new Promise((r) => setTimeout(r, 3000)) // slower than the 2s poll cadence
          return { ok: true, action: 'agent.list', sessions: [{ id: 'agent-slow', intent: 'x', status: 'running', startedAt: 't' }] }
        }
        return baseCmd(name, payload)
      }) as never

      render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // open the gate, start first poll
      // With the old setInterval+id guard the response (resolving at 3s) would be
      // discarded as stale by the 2s tick; the single-flight loop applies it.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
      expect(useStore.getState().sessions.map((s) => s.id)).toContain('agent-slow')
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a late snapshot delivered after the subscription is cleaned up', async () => {
    vi.useFakeTimers()
    try {
      let captured: ((m: EngineWsMessage) => void) | undefined
      const client = new FakeEngineClient()
      client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
      client.responses['agent.list'] = { ok: true, action: 'agent.list', sessions: [] }
      client.subscribe = ((_topics: string[], onMessage: (m: EngineWsMessage) => void) => {
        captured = onMessage
        return () => {}
      }) as typeof client.subscribe

      const { unmount } = render(<App client={client} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      act(() => captured!({ type: 'snapshot', apiVersion: '1', seq: 10, routes: [route('route-fresh')], tasks: [] }))
      expect(useStore.getState().routes.map((r) => r.id)).toEqual(['route-fresh'])

      unmount() // cleanup sets active = false
      // A late lower-seq snapshot from the now-closed socket must not roll the store back.
      act(() => captured!({ type: 'snapshot', apiVersion: '1', seq: 1, routes: [route('route-stale')], tasks: [] }))
      expect(useStore.getState().routes.map((r) => r.id)).toEqual(['route-fresh'])
    } finally {
      vi.useRealTimers()
    }
  })
})
