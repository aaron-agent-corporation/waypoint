import { listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from '@waypoint/folder-host'
import type { WaypointFolderRoute, WaypointFolderTask } from '@waypoint/folder-host'

import type { EngineEnvelope } from '../types.ts'
import { CommandBus } from './command-bus.ts'
import { EventHub } from './event-hub.ts'
import { RouteBroadcaster } from './route-broadcaster.ts'
import { WorkspaceSession } from './workspace-session.ts'
import { registerCatalogCommands } from './commands/catalog.ts'
import { registerMetaCommands } from './commands/meta.ts'
import { registerRunCommands } from './commands/run.ts'
import { registerWorkspaceCommands } from './commands/workspace.ts'

/** Shared context passed to every command-registration function. */
export interface EngineContext {
  readonly session: WorkspaceSession
  readonly hub: EventHub
  readonly broadcaster: RouteBroadcaster
  readonly startedAt: number
}

export interface EngineHost {
  readonly bus: CommandBus
  readonly hub: EventHub
  readonly session: WorkspaceSession
  readonly broadcaster: RouteBroadcaster
  dispatch(name: string, payload: unknown): Promise<EngineEnvelope>
  snapshot(): Promise<{ routes: WaypointFolderRoute[]; tasks: WaypointFolderTask[] }>
}

export interface EngineHostConfig {
  readonly startedAt?: number
  readonly pollIntervalMs?: number
}

export function createEngineHost(config: EngineHostConfig = {}): EngineHost {
  const session = new WorkspaceSession()
  const hub = new EventHub()
  const bus = new CommandBus()
  const broadcaster = new RouteBroadcaster({ hub, session, pollIntervalMs: config.pollIntervalMs })
  const ctx: EngineContext = { session, hub, broadcaster, startedAt: config.startedAt ?? Date.now() }

  registerMetaCommands(bus, ctx)
  registerWorkspaceCommands(bus, ctx)
  registerCatalogCommands(bus, ctx)
  registerRunCommands(bus, ctx)
  // gate/author command groups are registered in later tasks.

  return {
    bus,
    hub,
    session,
    broadcaster,
    dispatch: (name, payload) => bus.dispatch(name, payload),
    async snapshot() {
      const { root } = session.requireActive()
      const opts = session.beadsOptions()
      const [routes, tasks] = await Promise.all([
        listWaypointRuntimeRoutes(root, opts),
        listWaypointRuntimeTasks(root, opts),
      ])
      return { routes, tasks }
    },
  }
}
