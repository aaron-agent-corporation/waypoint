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
import { AgentRegistry } from '../brain/agent-registry.ts'
import { FakeBrainAdapter } from '../brain/fake-adapter.ts'
import type { BrainAdapter, BrainAdapterFactory } from '../brain/brain-adapter.ts'
import { registerAgentCommands } from './commands/agent.ts'
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
  readonly tokens: TokenRegistry
  readonly agents: AgentRegistry
  readonly brainFactory: BrainAdapterFactory
  readonly startedAt: number
  nextAgentId(): string
  getHostUrl(): string
}

function resolveBrainFactory(config: EngineHostConfig): BrainAdapterFactory {
  if (config.brainAdapterFactory) return config.brainAdapterFactory
  const provided = config.brainAdapter
  if (provided && typeof (provided as Partial<BrainAdapterFactory>).forSession === 'function') {
    return provided as unknown as BrainAdapterFactory
  }
  if (provided) return { forSession: () => provided }
  return new FakeBrainAdapter({ events: [], result: { status: 'completed' } })
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
  /** A brain adapter (also used as its own factory if it implements forSession). */
  readonly brainAdapter?: BrainAdapter
  /** A factory that mints a per-session adapter with loopback callback creds (Task 9 wires Pi here). */
  readonly brainAdapterFactory?: BrainAdapterFactory
}

export function createEngineHost(config: EngineHostConfig = {}): EngineHost {
  const session = new WorkspaceSession()
  const hub = new EventHub()
  const bus = new CommandBus()
  const tokens = new TokenRegistry()
  const agents = new AgentRegistry()
  const broadcaster = new RouteBroadcaster({ hub, session, pollIntervalMs: config.pollIntervalMs })
  let agentSeq = 0
  let hostUrl = ''
  const ctx: EngineContext = {
    session,
    hub,
    broadcaster,
    tokens,
    agents,
    brainFactory: resolveBrainFactory(config),
    startedAt: config.startedAt ?? Date.now(),
    nextAgentId: () => `agent-${String(++agentSeq).padStart(3, '0')}`,
    getHostUrl: () => hostUrl,
  }

  registerMetaCommands(bus, ctx)
  registerWorkspaceCommands(bus, ctx)
  registerCatalogCommands(bus, ctx)
  registerRunCommands(bus, ctx)
  registerGateCommands(bus, ctx)
  registerAuthorCommands(bus, ctx)
  registerAgentCommands(bus, ctx)

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
      hostUrl = result.url
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
