import { listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from '@waypoint/folder-host'
import type { WaypointFolderRoute, WaypointFolderTask } from '@waypoint/folder-host'

import type { EngineEnvelope } from '../types.ts'
import { CommandBus } from './command-bus.ts'
import { EventHub } from './event-hub.ts'
import { WorkspaceSession } from './workspace-session.ts'
import { registerCatalogCommands } from './commands/catalog.ts'
import { registerMetaCommands } from './commands/meta.ts'
import { registerWorkspaceCommands } from './commands/workspace.ts'

/** Shared context passed to every command-registration function. */
export interface EngineContext {
  readonly session: WorkspaceSession
  readonly hub: EventHub
  readonly startedAt: number
}

export interface EngineHost {
  readonly bus: CommandBus
  readonly hub: EventHub
  readonly session: WorkspaceSession
  dispatch(name: string, payload: unknown): Promise<EngineEnvelope>
  snapshot(): Promise<{ routes: WaypointFolderRoute[]; tasks: WaypointFolderTask[] }>
}

export interface EngineHostConfig {
  readonly startedAt?: number
}

export function createEngineHost(config: EngineHostConfig = {}): EngineHost {
  const session = new WorkspaceSession()
  const hub = new EventHub()
  const bus = new CommandBus()
  const ctx: EngineContext = { session, hub, startedAt: config.startedAt ?? Date.now() }

  registerMetaCommands(bus, ctx)
  registerWorkspaceCommands(bus, ctx)
  registerCatalogCommands(bus, ctx)
  // run/gate/author command groups are registered in later tasks.

  return {
    bus,
    hub,
    session,
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
