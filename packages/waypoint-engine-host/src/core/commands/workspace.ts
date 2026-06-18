import { ok } from '../../envelope.ts'
import type { EngineBackend } from '../../types.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerWorkspaceCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('workspace.open', async (payload) => {
    const input = (payload ?? {}) as {
      root?: string
      backend?: EngineBackend
      initBeads?: boolean
      force?: boolean
    }
    const workspace = await ctx.session.open({
      root: input.root ?? '',
      backend: input.backend,
      initBeads: input.initBeads,
      force: input.force,
    })
    return ok('workspace.open', { workspace })
  })

  bus.register('workspace.status', async () => {
    const status = await ctx.session.status()
    return ok('workspace.status', { status })
  })
}
