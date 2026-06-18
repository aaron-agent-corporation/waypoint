import {
  getWaypointRuntimeRoute,
  listWaypointRuntimeRoutes,
  listWaypointRuntimeTasks,
  pauseWaypointRoute,
  readWaypointRuntimeRouteEvents,
  resumeWaypointRoute,
  startQuestRoute,
} from '@waypoint/folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerRunCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('run.start', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    if (!input.quest) throw new EngineError('run.start requires a quest slug', { code: 'VALIDATION', field: 'quest' })
    const quest = input.quest
    const route = await ctx.session.mutate(() => startQuestRoute(root, { quest, ...ctx.session.beadsOptions() }))
    await ctx.broadcaster.emit(route.id)
    return ok('run.start', { route })
  })

  bus.register('routes.list', async () => {
    const { root } = ctx.session.requireActive()
    return ok('routes.list', { routes: await listWaypointRuntimeRoutes(root, ctx.session.beadsOptions()) })
  })

  bus.register('route.get', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    if (!input.routeId) throw new EngineError('route.get requires a routeId', { code: 'VALIDATION', field: 'routeId' })
    const route = await getWaypointRuntimeRoute(root, input.routeId, ctx.session.beadsOptions())
    if (!route) throw new EngineError(`Route not found: ${input.routeId}`, { code: 'NOT_FOUND', field: 'routeId' })
    return ok('route.get', { route })
  })

  bus.register('tasks.list', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    return ok('tasks.list', {
      tasks: await listWaypointRuntimeTasks(root, { routeId: input.routeId, ...ctx.session.beadsOptions() }),
    })
  })

  bus.register('route.events', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string; limit?: number; offset?: number }
    if (!input.routeId) throw new EngineError('route.events requires a routeId', { code: 'VALIDATION', field: 'routeId' })
    const page = await readWaypointRuntimeRouteEvents(root, input.routeId, {
      limit: input.limit,
      offset: input.offset,
      ...ctx.session.beadsOptions(),
    })
    // Flattened envelope (no nested { page } wrapper).
    return ok('route.events', { events: page.items, total: page.total, limit: page.limit, offset: page.offset })
  })

  bus.register('run.pause', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string; reason?: string }
    if (!input.routeId) throw new EngineError('run.pause requires a routeId', { code: 'VALIDATION', field: 'routeId' })
    const routeId = input.routeId
    const route = await ctx.session.mutate(() =>
      pauseWaypointRoute(root, { routeId, reason: input.reason, ...ctx.session.beadsOptions() }),
    )
    await ctx.broadcaster.emit(route.id)
    return ok('run.pause', { route })
  })

  bus.register('run.resume', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    if (!input.routeId) throw new EngineError('run.resume requires a routeId', { code: 'VALIDATION', field: 'routeId' })
    const routeId = input.routeId
    const route = await ctx.session.mutate(() =>
      resumeWaypointRoute(root, { routeId, ...ctx.session.beadsOptions() }),
    )
    await ctx.broadcaster.emit(route.id)
    return ok('run.resume', { route })
  })
}
