import { listWaypointRuntimeRoutes, listWaypointRuntimeTasks } from '@waypoint/folder-host'
import type { WaypointFolderRoute, WaypointFolderTask } from '@waypoint/folder-host'

import type { EngineEnvelope } from '../types.ts'
import { createHttpWsTransport, type HttpWsTransportOptions } from '../transport/http-ws/server.ts'
import type { Transport, TransportStartResult } from '../transport/transport.ts'
import { CommandBus, type DispatchContext } from './command-bus.ts'
import { TokenRegistry } from './token-registry.ts'
import { EventHub } from './event-hub.ts'
import { RouteBroadcaster } from './route-broadcaster.ts'
import { WorkspaceSession } from './workspace-session.ts'
import { registerAuthorCommands } from './commands/author.ts'
import { registerCatalogCommands } from './commands/catalog.ts'
import { registerGateCommands } from './commands/gate.ts'
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
  readonly tokens: TokenRegistry
  dispatch(name: string, payload: unknown, ctx?: DispatchContext): Promise<EngineEnvelope>
  snapshot(): Promise<{ routes: WaypointFolderRoute[]; tasks: WaypointFolderTask[] }>
  start(opts?: HttpWsTransportOptions): Promise<TransportStartResult>
  stop(): Promise<void>
}

export interface EngineHostConfig {
  readonly startedAt?: number
  readonly pollIntervalMs?: number
}

export function createEngineHost(config: EngineHostConfig = {}): EngineHost {
  const session = new WorkspaceSession()
  const hub = new EventHub()
  const bus = new CommandBus()
  const tokens = new TokenRegistry()
  const broadcaster = new RouteBroadcaster({ hub, session, pollIntervalMs: config.pollIntervalMs })
  const ctx: EngineContext = { session, hub, broadcaster, startedAt: config.startedAt ?? Date.now() }

  registerMetaCommands(bus, ctx)
  registerWorkspaceCommands(bus, ctx)
  registerCatalogCommands(bus, ctx)
  registerRunCommands(bus, ctx)
  registerGateCommands(bus, ctx)
  registerAuthorCommands(bus, ctx)

  let transport: Transport | null = null

  const engineHost: EngineHost = {
    bus,
    hub,
    session,
    broadcaster,
    tokens,
    dispatch: (name, payload, ctx) => bus.dispatch(name, payload, ctx),
    async snapshot() {
      const { root } = session.requireActive()
      const opts = session.beadsOptions()
      const [routes, tasks] = await Promise.all([
        listWaypointRuntimeRoutes(root, opts),
        listWaypointRuntimeTasks(root, opts),
      ])
      return { routes, tasks }
    },
    async start(startOpts?: HttpWsTransportOptions) {
      if (!transport) transport = createHttpWsTransport(engineHost, startOpts)
      const result = await transport.start()
      broadcaster.startPolling()
      return result
    },
    async stop() {
      broadcaster.stopPolling()
      if (transport) {
        await transport.stop()
        transport = null
      }
    },
  }

  return engineHost
}
