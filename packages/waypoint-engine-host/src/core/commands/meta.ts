import pkg from '../../../package.json' with { type: 'json' }
import { ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export const ENGINE_API_VERSION = '1'

export function registerMetaCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('meta.commands', () => ok('meta.commands', { commands: bus.names() }))

  bus.register('meta.health', () =>
    ok('meta.health', {
      workspaceOpen: ctx.session.current() !== null,
      seq: ctx.hub.currentSeq(),
      uptime: Date.now() - ctx.startedAt,
    }),
  )

  bus.register('meta.version', () => ok('meta.version', { apiVersion: ENGINE_API_VERSION, pkg: pkg.version }))
}
