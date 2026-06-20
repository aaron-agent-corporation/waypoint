import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost, type EngineHost } from '../engine-host.ts'
import { FakeBrainAdapter } from '../../brain/fake-adapter.ts'

function gatedAdapter(): { adapter: FakeBrainAdapter; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { adapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' }, gate }), release }
}

async function openHost(adapter: FakeBrainAdapter): Promise<{ host: EngineHost; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'wp-agent-life-'))
  const host = createEngineHost({ brainAdapter: adapter })
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('agent session lifecycle on workspace switch / host stop', () => {
  it('a forced workspace switch cancels running agent sessions', async () => {
    const { adapter, release } = gatedAdapter()
    const { host } = await openHost(adapter)
    const authored = (await host.dispatch('agent.author', { intent: 'x' })) as unknown as { sessionId: string }

    const root2 = await mkdtemp(join(tmpdir(), 'wp-agent-life2-'))
    await host.dispatch('workspace.open', { root: root2, backend: 'folder', force: true })

    release()
    await settle()
    const list = (await host.dispatch('agent.list', {})) as unknown as { sessions: { id: string; status: string }[] }
    expect(list.sessions.find((s) => s.id === authored.sessionId)?.status).toBe('cancelled')
  })

  it('host.stop cancels all running agent sessions', async () => {
    const { adapter, release } = gatedAdapter()
    const { host } = await openHost(adapter)
    const authored = (await host.dispatch('agent.author', { intent: 'x' })) as unknown as { sessionId: string }

    const list1 = (await host.dispatch('agent.list', {})) as unknown as { sessions: { id: string; status: string }[] }
    expect(list1.sessions.find((s) => s.id === authored.sessionId)?.status).toBe('running')

    await host.stop()
    release()
    await settle()
    const list2 = (await host.dispatch('agent.list', {})) as unknown as { sessions: { id: string; status: string }[] }
    expect(list2.sessions.find((s) => s.id === authored.sessionId)?.status).toBe('cancelled')
  })
})
