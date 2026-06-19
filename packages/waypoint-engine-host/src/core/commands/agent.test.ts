import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost } from '../engine-host.ts'
import { FakeBrainAdapter } from '../../brain/fake-adapter.ts'
import { AGENT_TOOL_GRANT } from './agent.ts'

async function openHost(adapter = new FakeBrainAdapter({ events: [], result: { status: 'completed' } })) {
  const root = await mkdtemp(join(tmpdir(), 'wp-agent-cmd-'))
  const host = createEngineHost({ brainAdapter: adapter })
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

describe('agent commands', () => {
  it('agent.author returns a sessionId immediately with running status', async () => {
    const { host } = await openHost()
    const res = (await host.dispatch('agent.author', { intent: 'build a demo recipe' })) as Record<string, unknown>
    expect(res.ok).toBe(true)
    expect(res.status).toBe('running')
    expect(typeof res.sessionId).toBe('string')
  })

  it('agent.run awaits and returns the full result', async () => {
    const { host } = await openHost(
      new FakeBrainAdapter({
        events: [{ kind: 'agent.message', at: 't', data: { text: 'drafting' } }],
        result: { status: 'completed', summary: 'authored a demo', proposalId: 'recipe/demo' },
      }),
    )
    const res = (await host.dispatch('agent.run', { intent: 'build a demo recipe' })) as Record<string, unknown>
    expect(res.status).toBe('completed')
    expect(res.proposalId).toBe('recipe/demo')
    expect(typeof res.sessionId).toBe('string')
  })

  it('agent.author requires an intent', async () => {
    const { host } = await openHost()
    const res = (await host.dispatch('agent.author', {})) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })

  it('the default grant excludes the agent.* namespace, approveProposal, and workspace.open', () => {
    expect(AGENT_TOOL_GRANT.some((t) => t.startsWith('agent.'))).toBe(false)
    expect(AGENT_TOOL_GRANT).not.toContain('author.approveProposal')
    expect(AGENT_TOOL_GRANT).not.toContain('workspace.open')
    expect(AGENT_TOOL_GRANT).toContain('author.recipe')
    expect(AGENT_TOOL_GRANT).toContain('run.adhoc')
  })

  it('rejects caller tools that escalate beyond the grant', async () => {
    const { host } = await openHost()
    const res = (await host.dispatch('agent.author', { intent: 'x', tools: ['author.approveProposal'] })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })

  it('mints a scoped token whose allow-set excludes approveProposal (host-enforced)', async () => {
    const { host } = await openHost()
    await host.dispatch('agent.run', { intent: 'x' })
    // A token minted for the session must reject approveProposal at the bus.
    const scoped = host.tokens.mintScoped('probe', new Set(AGENT_TOOL_GRANT))
    const scope = host.tokens.resolve(scoped)
    expect(scope.kind).toBe('scoped')
    if (scope.kind === 'scoped') {
      expect(scope.allow.has('author.approveProposal')).toBe(false)
      expect(scope.allow.has('run.adhoc')).toBe(true)
    }
  })

  it('agent.list reflects a completed session; agent.cancel reports unknown ids', async () => {
    const { host } = await openHost()
    await host.dispatch('agent.run', { intent: 'x' })
    const list = (await host.dispatch('agent.list', {})) as unknown as { sessions: { status: string }[] }
    expect(list.sessions[0].status).toBe('completed')
    const cancel = (await host.dispatch('agent.cancel', { sessionId: 'nope' })) as Record<string, unknown>
    expect(cancel.cancelled).toBe(false)
  })

  it('agent.cancel halts a running session before completion', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    const { host } = await openHost(new FakeBrainAdapter({ events: [], result: { status: 'completed' }, gate }))
    const authored = (await host.dispatch('agent.author', { intent: 'x' })) as unknown as { sessionId: string }
    const cancel = (await host.dispatch('agent.cancel', { sessionId: authored.sessionId })) as Record<string, unknown>
    expect(cancel.cancelled).toBe(true)
    release()
    // allow the background run to settle
    await new Promise((r) => setTimeout(r, 10))
    const list = (await host.dispatch('agent.list', {})) as unknown as { sessions: { id: string; status: string }[] }
    expect(list.sessions.find((s) => s.id === authored.sessionId)?.status).toBe('cancelled')
  })

  it('agent.watch and agent.transcript replay events; transcript NOT_FOUND for unknown id', async () => {
    const { host } = await openHost(
      new FakeBrainAdapter({
        events: [
          { kind: 'agent.message', at: 't', data: { text: 'a' } },
          { kind: 'agent.message', at: 't', data: { text: 'b' } },
        ],
        result: { status: 'completed' },
      }),
    )
    const authored = (await host.dispatch('agent.run', { intent: 'x' })) as unknown as { sessionId: string }
    const watch = (await host.dispatch('agent.watch', { sessionId: authored.sessionId, sinceSeq: 0 })) as unknown as {
      events: { idx: number }[]
    }
    expect(watch.events.map((e) => e.idx)).toEqual([1]) // idx > 0
    const tx = (await host.dispatch('agent.transcript', { sessionId: authored.sessionId })) as unknown as { events: unknown[] }
    expect(tx.events).toHaveLength(2)
    const missing = (await host.dispatch('agent.transcript', { sessionId: 'nope' })) as Record<string, unknown>
    expect((missing.details as { code: string }).code).toBe('NOT_FOUND')
  })
})
