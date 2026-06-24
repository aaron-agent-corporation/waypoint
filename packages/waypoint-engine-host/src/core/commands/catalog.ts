import { formatCatalogEntryWarning, loadWorkspaceWaypointCatalog } from '@waypoint/folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerCatalogCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('catalog.quests', async () => {
    const { root } = ctx.session.requireActive()
    const catalog = await loadWorkspaceWaypointCatalog(root)
    // Skip-and-warn: one malformed authored manifest must not blank the listing.
    return ok('catalog.quests', {
      quests: catalog.quests.list(),
      warnings: catalog.questErrors.map(formatCatalogEntryWarning),
    })
  })

  bus.register('catalog.recipes', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    const catalog = await loadWorkspaceWaypointCatalog(root)
    if (input.quest) {
      const resolved = catalog.resolveQuestRecipes(input.quest)
      if (resolved.ok === false) {
        throw new EngineError(resolved.message, { code: 'NOT_FOUND', field: 'quest' })
      }
      // The quest-scoped branch is resolution-only: it lists the recipe winners
      // THIS quest references. Unrelated malformed files are out of scope (a
      // malformed file the quest *does* reference already fails loud above), so
      // warnings is always empty here — kept for payload-shape stability (B4/P3-1).
      return ok('catalog.recipes', { quest: input.quest, recipes: resolved.recipes, warnings: [] })
    }
    return ok('catalog.recipes', {
      recipes: catalog.recipes.list(),
      warnings: catalog.recipeErrors.map(formatCatalogEntryWarning),
    })
  })
}
