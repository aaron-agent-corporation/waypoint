import { loadBundledWaypointCatalog } from '@waypoint/folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerCatalogCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('catalog.quests', async () => {
    ctx.session.requireActive()
    const catalog = await loadBundledWaypointCatalog()
    return ok('catalog.quests', { quests: catalog.quests.list() })
  })

  bus.register('catalog.recipes', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    const catalog = await loadBundledWaypointCatalog()
    if (input.quest) {
      const resolved = catalog.resolveQuestRecipes(input.quest)
      if (resolved.ok === false) {
        throw new EngineError(resolved.message, { code: 'NOT_FOUND', field: 'quest' })
      }
      return ok('catalog.recipes', { quest: input.quest, recipes: resolved.recipes })
    }
    return ok('catalog.recipes', { recipes: catalog.recipes.list() })
  })
}
