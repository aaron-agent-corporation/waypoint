import { formatCatalogEntryWarning, installQuestCatalog, loadBundledWaypointCatalog, loadWorkspaceWaypointCatalog } from '@waypoint/folder-host'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

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

  bus.register('catalog.install', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    if (!input.quest) {
      throw new EngineError('catalog.install requires a quest slug', { code: 'VALIDATION', field: 'quest' })
    }
    const quest = input.quest
    // workspace-wins: preserve an authored quest manifest rather than clobbering it.
    const questPath = join(root, '.waypoint', 'quests', `${quest}.yaml`)
    const questAlreadyAuthored = await access(questPath).then(() => true).catch(() => false)
    const catalog = await loadBundledWaypointCatalog()
    // Validate the quest exists in the bundled catalog before attempting install.
    const resolved = catalog.resolveQuestRecipes(quest)
    if (!resolved.ok) {
      throw new EngineError(resolved.message, { code: 'NOT_FOUND', field: 'quest' })
    }
    const result = await ctx.session.mutate(() =>
      installQuestCatalog(root, catalog, { quest, preserveExistingQuest: questAlreadyAuthored }),
    )
    return ok('catalog.install', {
      quest: result.quest,
      recipes: result.recipes,
      installedQuestPaths: result.installedQuestPaths,
      installedRecipePaths: result.installedRecipePaths,
    })
  })
}
