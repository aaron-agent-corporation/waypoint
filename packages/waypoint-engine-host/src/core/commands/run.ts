import {
  AdhocManifestError,
  getWaypointRuntimeRoute,
  listWaypointRuntimeRoutes,
  listWaypointRuntimeTasks,
  pauseWaypointRoute,
  readWaypointRuntimeRouteEvents,
  resumeWaypointRoute,
  runWaypointAutopilot,
  startAdhocRoute,
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

  // Ad-hoc execution from agent-authored drafts (folder backend only, slice 2).
  // Materialize under the mutex; run the autopilot OUTSIDE it so a long recipe
  // run never blocks other workspace mutations (Eng decision 16). The owning
  // agent session's id (from the scoped token, never the payload — Lock 3) and
  // its AbortSignal are threaded so agent.cancel can stop the run.
  bus.register('run.adhoc', async (payload, dispatchCtx) => {
    const { root, backend } = ctx.session.requireActive()
    if (backend === 'beads') {
      throw new EngineError('run.adhoc supports the folder backend only in slice 2', { code: 'VALIDATION', field: 'backend' })
    }
    const input = (payload ?? {}) as { questYaml?: string; recipeYamls?: readonly string[]; dryRun?: boolean }
    if (!input.questYaml || typeof input.questYaml !== 'string') {
      throw new EngineError('run.adhoc requires questYaml', { code: 'VALIDATION', field: 'questYaml' })
    }
    const questYaml = input.questYaml
    const recipeYamls = input.recipeYamls ?? []
    const sessionId = dispatchCtx?.agentSessionId ?? `adhoc-${Date.now().toString(36)}`

    let started
    try {
      started = await ctx.session.mutate(() =>
        startAdhocRoute(root, { sessionId, questYaml, recipeYamls, dryRun: true }),
      )
    } catch (error) {
      if (error instanceof AdhocManifestError) {
        throw new EngineError(error.message, { code: 'VALIDATION', field: error.field })
      }
      throw error
    }

    if (!input.dryRun) {
      await runWaypointAutopilot(root, { routeId: started.id, catalogDir: started.overlay, signal: dispatchCtx?.signal })
    }

    const route = (await getWaypointRuntimeRoute(root, started.id, ctx.session.beadsOptions())) ?? started
    await ctx.broadcaster.emit(route.id)
    return ok('run.adhoc', { route })
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
