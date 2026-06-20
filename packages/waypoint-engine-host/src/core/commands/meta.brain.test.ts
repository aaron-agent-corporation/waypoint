import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost } from '../engine-host.ts'
import { FakeBrainAdapter } from '../../brain/fake-adapter.ts'

async function openHost(config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wp-meta-brain-'))
  const host = createEngineHost(config)
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

describe('meta active-brain reporting', () => {
  it("meta.health and meta.version report brain 'fake' by default", async () => {
    const { host } = await openHost()
    const health = (await host.dispatch('meta.health', {})) as Record<string, unknown>
    expect(health.brain).toBe('fake')
    const version = (await host.dispatch('meta.version', {})) as Record<string, unknown>
    expect(version.brain).toBe('fake')
    expect(version.brainVersion).toBeUndefined()
  })

  it('reports the pi brain + version when configured', async () => {
    const { host } = await openHost({
      brainAdapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' } }),
      brain: 'pi',
      brainVersion: '0.55.3',
    })
    const health = (await host.dispatch('meta.health', {})) as Record<string, unknown>
    expect(health.brain).toBe('pi')
    expect(health.brainVersion).toBe('0.55.3')
  })
})
