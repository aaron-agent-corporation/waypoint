import { describe, expect, it } from 'vitest'

import { EventHub } from './event-hub.ts'
import type { AgentEventRecord, EngineEvent } from '../types.ts'

const arec = (over: Partial<AgentEventRecord> = {}): AgentEventRecord => ({
  id: 'e1',
  sessionId: 's1',
  kind: 'agent.message',
  at: '2026-06-18T00:00:00Z',
  ...over,
})

const routeRecord = (id: string) =>
  ({ id, kind: 'route.started', created_at: '2026-01-01T00:00:00Z', payload: {} }) as never

describe('EventHub agent events', () => {
  it('publishes agent records on an agent topic with a monotonic seq', () => {
    const hub = new EventHub()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['agent:s1']), deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    const ev = hub.publishAgent('agent:s1', arec())
    expect(ev.seq).toBe(1)
    expect(ev.topic).toBe('agent:s1')
    expect(seen).toHaveLength(1)
    expect((seen[0].record as AgentEventRecord).kind).toBe('agent.message')
  })

  it('does not deliver agent events to mismatched-topic subscribers', () => {
    const hub = new EventHub()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['agent:other']), deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    hub.publishAgent('agent:s1', arec())
    expect(seen).toHaveLength(0)
  })

  it('shares the seq sequence between route and agent publishes', () => {
    const hub = new EventHub()
    const a = hub.publishAgent('agent:s1', arec())
    const b = hub.publishAgent('agent:s1', arec({ id: 'e2' }))
    expect(b.seq).toBe(a.seq + 1)
  })

  it('agent chatter does not evict route events from a reconnecting route subscriber', () => {
    const hub = new EventHub({ ringSize: 8, agentRingSize: 8 })
    const routeEv = hub.publish('route:r1', routeRecord('r-evt'))
    for (let i = 0; i < 50; i++) hub.publishAgent('agent:s1', arec({ id: `a${i}` }))

    const replayed: EngineEvent[] = []
    let resnapshotted = false
    hub.subscribe(
      {
        topics: new Set(['route:r1']),
        deliver: (e) => replayed.push(e),
        requestResnapshot: () => {
          resnapshotted = true
        },
      },
      routeEv.seq - 1,
    )

    expect(resnapshotted).toBe(false)
    expect(replayed.some((e) => (e.record as { id?: string }).id === 'r-evt')).toBe(true)
  })

  it('resnapshots an agent subscriber whose next-needed agent event was evicted', () => {
    const hub = new EventHub({ agentRingSize: 2 })
    hub.publishAgent('agent:s1', arec({ id: 'a1' })) // seq 1 (evicted)
    hub.publishAgent('agent:s1', arec({ id: 'a2' })) // seq 2
    hub.publishAgent('agent:s1', arec({ id: 'a3' })) // seq 3

    let resnapshotted = false
    hub.subscribe(
      { topics: new Set(['agent:s1']), deliver: () => {}, requestResnapshot: () => { resnapshotted = true } },
      0, // next-needed seq 1 was evicted
    )
    expect(resnapshotted).toBe(true)
  })
})
