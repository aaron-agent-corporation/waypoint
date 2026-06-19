import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'

import type { AgentEventRecord, EngineEvent } from '../types.ts'

export interface EventSubscriber {
  readonly topics: ReadonlySet<string> | '*'
  deliver(event: EngineEvent): void
  requestResnapshot(): void
}

function matches(sub: EventSubscriber, topic: string): boolean {
  return sub.topics === '*' || sub.topics.has(topic)
}

function wantsAgent(sub: EventSubscriber): boolean {
  return sub.topics === '*' || [...sub.topics].some((t) => t.startsWith('agent:'))
}

function wantsRoute(sub: EventSubscriber): boolean {
  return sub.topics === '*' || [...sub.topics].some((t) => !t.startsWith('agent:'))
}

/**
 * In-process event fan-out with a monotonic seq shared across route and agent
 * events, plus TWO independent ring buffers for reconnect replay. Route events
 * and agent events get separate ring budgets so a chatty agent run cannot evict
 * `route:*` deltas a reconnecting route subscriber still needs (MAR Contract
 * Lock 8 / autoplan decision 15). The durable event log remains the source of
 * truth; this hub is a low-latency delivery + resume cache.
 */
export class EventHub {
  private seq = 0
  private readonly routeRing: EngineEvent[] = []
  private readonly agentRing: EngineEvent[] = []
  private routeEvicted = 0
  private agentEvicted = 0
  private readonly maxRoute: number
  private readonly maxAgent: number
  private readonly subscribers = new Set<EventSubscriber>()

  constructor(opts: { ringSize?: number; agentRingSize?: number } = {}) {
    this.maxRoute = opts.ringSize ?? 1000
    this.maxAgent = opts.agentRingSize ?? 1000
  }

  currentSeq(): number {
    return this.seq
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0
  }

  publish(topic: string, record: WaypointFolderRouteEvent): EngineEvent {
    return this.emit(topic, record, this.routeRing, this.maxRoute, 'route')
  }

  publishAgent(topic: string, record: AgentEventRecord): EngineEvent {
    return this.emit(topic, record, this.agentRing, this.maxAgent, 'agent')
  }

  private emit(
    topic: string,
    record: WaypointFolderRouteEvent | AgentEventRecord,
    ring: EngineEvent[],
    max: number,
    kind: 'route' | 'agent',
  ): EngineEvent {
    const event: EngineEvent = { seq: ++this.seq, topic, record }
    ring.push(event)
    while (ring.length > max) {
      const dropped = ring.shift()
      if (!dropped) break
      if (kind === 'route') this.routeEvicted = Math.max(this.routeEvicted, dropped.seq)
      else this.agentEvicted = Math.max(this.agentEvicted, dropped.seq)
    }
    for (const sub of this.subscribers) {
      if (matches(sub, topic)) this.safeDeliver(sub, event)
    }
    return event
  }

  subscribe(sub: EventSubscriber, lastSeq?: number): () => void {
    if (lastSeq !== undefined) {
      if (lastSeq > this.seq) {
        // Process restarted / seq reset: the client is ahead of us. Re-snapshot.
        sub.requestResnapshot()
      } else {
        // Resnapshot only if a ring the subscriber cares about dropped an event
        // it still needs (next-needed seq is lastSeq + 1, i.e. lastSeq < evicted).
        const missedRoute = wantsRoute(sub) && lastSeq < this.routeEvicted
        const missedAgent = wantsAgent(sub) && lastSeq < this.agentEvicted
        if (missedRoute || missedAgent) {
          sub.requestResnapshot()
        } else {
          const merged = [...this.routeRing, ...this.agentRing].sort((a, b) => a.seq - b.seq)
          for (const event of merged) {
            if (event.seq > lastSeq && matches(sub, event.topic)) this.safeDeliver(sub, event)
          }
        }
      }
    }
    this.subscribers.add(sub)
    return () => {
      this.subscribers.delete(sub)
    }
  }

  private safeDeliver(sub: EventSubscriber, event: EngineEvent): void {
    try {
      sub.deliver(event)
    } catch {
      // One bad subscriber must not abort fan-out to the others.
    }
  }
}
