import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'

import type { EngineEvent } from '../types.ts'

export interface EventSubscriber {
  readonly topics: ReadonlySet<string> | '*'
  deliver(event: EngineEvent): void
  requestResnapshot(): void
}

function matches(sub: EventSubscriber, topic: string): boolean {
  return sub.topics === '*' || sub.topics.has(topic)
}

/**
 * In-process event fan-out with monotonic seq + a bounded ring buffer for
 * reconnect replay. The durable event log (Task 7 RouteBroadcaster) is the
 * source of truth; this hub is a low-latency delivery + resume cache.
 */
export class EventHub {
  private seq = 0
  private readonly ring: EngineEvent[] = []
  private readonly maxRing: number
  private readonly subscribers = new Set<EventSubscriber>()

  constructor(opts: { ringSize?: number } = {}) {
    this.maxRing = opts.ringSize ?? 1000
  }

  currentSeq(): number {
    return this.seq
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0
  }

  publish(topic: string, record: WaypointFolderRouteEvent): EngineEvent {
    const event: EngineEvent = { seq: ++this.seq, topic, record }
    this.ring.push(event)
    if (this.ring.length > this.maxRing) this.ring.shift()
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
        const oldest = this.ring[0]?.seq
        if (oldest !== undefined && lastSeq < oldest - 1) {
          sub.requestResnapshot()
        } else {
          for (const event of this.ring) {
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
