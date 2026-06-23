import { beforeEach, describe, expect, it } from 'vitest'

import type { AgentEventRecord, EngineWsMessage } from './engine/types'
import { useStore } from './store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function agentEvent(seq: number, sessionId: string, idx: number, kind = 'agent.message'): EngineWsMessage {
  const record: AgentEventRecord = { id: `ev-${idx}`, sessionId, kind, at: 't', idx }
  return { type: 'event', topic: `agent:${sessionId}`, seq, record }
}

function snapshot(seq: number, routeIds: string[]): EngineWsMessage {
  return {
    type: 'snapshot',
    apiVersion: '1',
    seq,
    routes: routeIds.map((id) => ({ id, quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' })),
    tasks: [],
  }
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

  it('bumps routesEpoch on a route event and again on resnapshot (so each change retriggers a refetch)', () => {
    const { applyMessage } = useStore.getState()
    const start = useStore.getState().routesEpoch
    applyMessage({ type: 'event', topic: 'route:route-001', seq: 3, record: { kind: 'route.started' } })
    expect(useStore.getState().routesEpoch).toBe(start + 1)
    applyMessage({ type: 'resnapshot' })
    expect(useStore.getState().routesEpoch).toBe(start + 2)
  })

  it('rehydrates from a lower-seq snapshot and re-bases seq (engine restart / seq-reset recovery)', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(snapshot(10, ['route-old']))
    expect(useStore.getState().seq).toBe(10)

    // Engine restarts → fresh authoritative snapshot with a LOWER seq + new state.
    applyMessage(snapshot(4, ['route-new']))
    let s = useStore.getState()
    expect(s.seq).toBe(4) // re-based to the new hub seq, not held at the stale 10
    expect(s.routes.map((r) => r.id)).toEqual(['route-new']) // rehydrated, not stranded
    expect(s.connection).toBe('open')

    // A post-restart event (seq > the re-based mark) now flows and drives a refetch.
    const epoch = useStore.getState().routesEpoch
    applyMessage({ type: 'event', topic: 'route:route-new', seq: 5, record: { kind: 'route.updated' } })
    s = useStore.getState()
    expect(s.routesEpoch).toBe(epoch + 1)
    expect(s.seq).toBe(5)
  })

  it('records an error frame into the store', () => {
    useStore.getState().applyMessage({ type: 'error', error: 'engine exploded' })
    expect(useStore.getState().error).toBe('engine exploded')
  })

  it('clears prior WS + routes errors when a fresh snapshot arrives (same-channel recovery)', () => {
    const { applyMessage, setRoutesError } = useStore.getState()
    applyMessage({ type: 'error', error: 'engine exploded' })
    setRoutesError('routes.list failed')
    applyMessage(snapshot(1, ['route-001']))
    const s = useStore.getState()
    expect(s.error).toBeNull()
    expect(s.routesError).toBeNull()
  })
})
