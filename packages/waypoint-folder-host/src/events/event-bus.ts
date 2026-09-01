import type { IEventBus } from '@waypoint/core'

import { appendRouteEvent } from './jsonl.ts'

export function createRouteEventBus(projectRoot: string, routeId: string): IEventBus {
  return {
    async publish(event) {
      await appendRouteEvent(projectRoot, routeId, {
        kind: event.type,
        payload: event.payload,
        now: new Date(event.timestamp * 1000),
      })
    },
  }
}
