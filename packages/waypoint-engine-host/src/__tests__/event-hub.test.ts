import { describe, expect, it } from 'vitest'

import { EventHub } from '../core/event-hub.ts'
import type { EngineEvent } from '../types.ts'

const rec = (kind: string) => ({ id: `e-${kind}`, route_id: 'route-001', kind, created_at: '2026-01-01T00:00:00Z' })

function collector() {
  const events: EngineEvent[] = []
  let resnapshots = 0
  return {
    events,
    get resnapshots() {
      return resnapshots
    },
    sub: (topics: ReadonlySet<string> | '*') => ({
      topics,
      deliver: (e: EngineEvent) => {
        events.push(e)
      },
      requestResnapshot: () => {
        resnapshots += 1
      },
    }),
  }
}

describe('EventHub', () => {
  it('assigns monotonic seq and fans out to matching subscribers', () => {
    const hub = new EventHub()
    const c = collector()
    hub.subscribe(c.sub(new Set(['route:route-001'])))
    const e1 = hub.publish('route:route-001', rec('a'))
    const e2 = hub.publish('route:route-001', rec('b'))
    expect([e1.seq, e2.seq]).toEqual([1, 2])
    expect(c.events.map((e) => e.record.kind)).toEqual(['a', 'b'])
    expect(hub.currentSeq()).toBe(2)
  })

  it('does not deliver non-matching topics; wildcard receives all', () => {
    const hub = new EventHub()
    const specific = collector()
    const all = collector()
    hub.subscribe(specific.sub(new Set(['route:route-999'])))
    hub.subscribe(all.sub('*'))
    hub.publish('route:route-001', rec('a'))
    expect(specific.events).toHaveLength(0)
    expect(all.events).toHaveLength(1)
  })

  it('replays buffered events newer than lastSeq on subscribe', () => {
    const hub = new EventHub()
    hub.publish('route:route-001', rec('a')) // seq 1
    hub.publish('route:route-001', rec('b')) // seq 2
    const c = collector()
    hub.subscribe(c.sub('*'), 1)
    expect(c.events.map((e) => e.seq)).toEqual([2])
  })

  it('requests re-snapshot when the next needed seq was evicted from the ring', () => {
    const hub = new EventHub({ ringSize: 2 })
    hub.publish('route:route-001', rec('a')) // 1 (evicted — ring holds [2,3])
    hub.publish('route:route-001', rec('b')) // 2
    hub.publish('route:route-001', rec('c')) // 3
    const c = collector()
    // Client at lastSeq=0 needs seq 1, which was evicted → gap → resnapshot.
    hub.subscribe(c.sub('*'), 0)
    expect(c.resnapshots).toBe(1)
    expect(c.events).toHaveLength(0)
  })

  it('replays without resnapshot when lastSeq is contiguous with the ring', () => {
    const hub = new EventHub({ ringSize: 2 })
    hub.publish('route:route-001', rec('a')) // 1 (evicted)
    hub.publish('route:route-001', rec('b')) // 2
    hub.publish('route:route-001', rec('c')) // 3
    const c = collector()
    // Client at lastSeq=1: next needed seq is 2, present in ring → replay 2,3.
    hub.subscribe(c.sub('*'), 1)
    expect(c.resnapshots).toBe(0)
    expect(c.events.map((e) => e.seq)).toEqual([2, 3])
  })

  it('requests re-snapshot when lastSeq exceeds currentSeq (process restarted, seq reset)', () => {
    const hub = new EventHub()
    hub.publish('route:route-001', rec('a')) // seq 1
    const c = collector()
    hub.subscribe(c.sub('*'), 42)
    expect(c.resnapshots).toBe(1)
    expect(c.events).toHaveLength(0)
  })

  it('stops delivering after unsubscribe', () => {
    const hub = new EventHub()
    const c = collector()
    const unsub = hub.subscribe(c.sub('*'))
    unsub()
    hub.publish('route:route-001', rec('a'))
    expect(c.events).toHaveLength(0)
  })

  it('a throwing subscriber does not abort fan-out to others', () => {
    const hub = new EventHub()
    const good = collector()
    hub.subscribe({
      topics: '*',
      deliver: () => {
        throw new Error('bad subscriber')
      },
      requestResnapshot: () => {},
    })
    hub.subscribe(good.sub('*'))
    expect(() => hub.publish('route:route-001', rec('a'))).not.toThrow()
    expect(good.events).toHaveLength(1)
  })
})
