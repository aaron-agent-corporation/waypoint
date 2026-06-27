import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from './context'
import { useEngineCommand } from './useEngineCommand'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function Harness({ client, onReady }: { client: FakeEngineClient; onReady: (api: ReturnType<typeof useEngineCommand>) => void }) {
  const api = useEngineCommand()
  onReady(api)
  return null
}

describe('useEngineCommand', () => {
  it('bumps routesEpoch and clears controlError on success', async () => {
    const client = new FakeEngineClient()
    client.responses['run.pause'] = { ok: true, action: 'run.pause', route: { id: 'r1' } } as never
    useStore.setState({ controlError: 'stale' })
    let api!: ReturnType<typeof useEngineCommand>
    render(<ClientProvider client={client}><Harness client={client} onReady={(a) => (api = a)} /></ClientProvider>)
    const epoch = useStore.getState().routesEpoch
    await act(async () => { await api.run('run.pause', { routeId: 'r1' }) })
    expect(client.calls.at(-1)).toEqual({ name: 'run.pause', payload: { routeId: 'r1' } })
    expect(useStore.getState().routesEpoch).toBe(epoch + 1)
    expect(useStore.getState().controlError).toBeNull()
  })

  it('sets controlError and rethrows on a non-ok envelope', async () => {
    const client = new FakeEngineClient()
    client.responses['run.pause'] = { ok: false, action: 'run.pause', error: 'nope' } as never
    let api!: ReturnType<typeof useEngineCommand>
    render(<ClientProvider client={client}><Harness client={client} onReady={(a) => (api = a)} /></ClientProvider>)
    await act(async () => { await expect(api.run('run.pause', { routeId: 'r1' })).rejects.toThrow('nope') })
    expect(useStore.getState().controlError).toBe('nope')
    expect(useStore.getState().routesEpoch).toBe(initial.routesEpoch)
  })
})
