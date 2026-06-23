import { beforeEach, describe, expect, it } from 'vitest'

import type { AgentEventRecord, EngineWsMessage } from './engine/types'
import { useStore } from './store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function agentEvent(seq: number, sessionId: string, idx: number, kind = 'agent.message'): EngineWsMessage {
  const record: AgentEventRecord = { id: `ev-${idx}`, sessionId, kind, at: 't', idx }
  return { type: 'event', topic: `agent:${sessionId}`, seq, record }
}

describe('store.applyMessage', () => {
  it('hydrates routes + tasks + seq from a snapshot and marks the connection open', () => {
    useStore.getState().applyMessage({
      type: 'snapshot',
      apiVersion: '1',
      seq: 5,
      routes: [{ id: 'route-001', quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
      tasks: [],
    })
    const s = useStore.getState()
    expect(s.seq).toBe(5)
    expect(s.routes).toHaveLength(1)
    expect(s.connection).toBe('open')
  })

  it('appends agent events to the right transcript and dedupes by idx', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(agentEvent(6, 'agent-001', 0))
    applyMessage(agentEvent(7, 'agent-001', 1))
    applyMessage(agentEvent(7, 'agent-001', 1)) // duplicate seq+idx
    expect(useStore.getState().transcripts['agent-001'].map((e) => e.idx)).toEqual([0, 1])
  })

  it('ignores stale (already-seen seq) events', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(agentEvent(10, 'agent-001', 0))
    applyMessage(agentEvent(9, 'agent-001', 1)) // stale
    expect(useStore.getState().transcripts['agent-001'].map((e) => e.idx)).toEqual([0])
  })

  it('marks routes dirty on a route event and on resnapshot', () => {
    const { applyMessage } = useStore.getState()
    applyMessage({ type: 'event', topic: 'route:route-001', seq: 3, record: { kind: 'route.started' } })
    expect(useStore.getState().routesDirty).toBe(true)
    useStore.getState().clearDirty()
    applyMessage({ type: 'resnapshot' })
    expect(useStore.getState().routesDirty).toBe(true)
  })
})
