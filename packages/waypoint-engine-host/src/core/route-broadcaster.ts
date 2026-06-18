import { readWaypointRuntimeRouteEvents } from '@waypoint/folder-host'

import type { EventHub } from './event-hub.ts'
import type { WorkspaceSession } from './workspace-session.ts'

export interface RouteBroadcasterDeps {
  readonly hub: EventHub
  readonly session: WorkspaceSession
  readonly pollIntervalMs?: number
}

/**
 * Produces live deltas by ID-diffing the durable route-event log
 * (`readWaypointRuntimeRouteEvents`) — the single source of truth. After a
 * mutating command, a "hint" call to `emit(routeId)` reads the log and publishes
 * only events whose stable id has not been broadcast for that route, serialized
 * per route so interleaved commands never double-publish. Integer offsets are
 * deliberately avoided (Beads re-sorts events with positional ids).
 */
export class RouteBroadcaster {
  private readonly broadcast = new Map<string, Set<string>>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: RouteBroadcasterDeps) {}

  /** Read the durable log for a route and publish any not-yet-broadcast events. */
  async emit(routeId: string): Promise<void> {
    const prev = this.locks.get(routeId) ?? Promise.resolve()
    const run = prev.then(
      () => this.doEmit(routeId),
      () => this.doEmit(routeId),
    )
    this.locks.set(
      routeId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  /** Start the subscriber-gated poll tick that surfaces out-of-band writes. */
  startPolling(): void {
    const interval = this.deps.pollIntervalMs ?? 0
    if (interval <= 0 || this.pollTimer) return
    this.pollTimer = setInterval(() => {
      void this.pollTick()
    }, interval)
    if (typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) this.pollTimer.unref()
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** Drop per-route state (e.g. on workspace switch). */
  reset(): void {
    this.broadcast.clear()
    this.locks.clear()
  }

  private async pollTick(): Promise<void> {
    if (!this.deps.hub.hasSubscribers()) return
    for (const routeId of this.broadcast.keys()) {
      await this.emit(routeId)
    }
  }

  private async doEmit(routeId: string): Promise<void> {
    const { root } = this.deps.session.requireActive()
    const seen = this.broadcast.get(routeId) ?? new Set<string>()
    const page = await readWaypointRuntimeRouteEvents(root, routeId, {
      limit: 1000,
      ...this.deps.session.beadsOptions(),
    })
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        this.deps.hub.publish(`route:${routeId}`, item)
        seen.add(item.id)
      }
    }
    this.broadcast.set(routeId, seen)
  }
}
