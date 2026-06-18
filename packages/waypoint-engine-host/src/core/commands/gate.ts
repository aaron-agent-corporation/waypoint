import { appendTaskDiscussionMessage, approveRouteGate, readTaskDiscussionMessages, rejectRouteGate } from '@waypoint/folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerGateCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('gate.decide', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as {
      routeId?: string
      node?: string
      decision?: string
      note?: string
      nextNode?: string
    }
    if (!input.routeId) throw new EngineError('gate.decide requires a routeId', { code: 'VALIDATION', field: 'routeId' })
    if (!input.node) throw new EngineError('gate.decide requires a node', { code: 'VALIDATION', field: 'node' })
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      throw new EngineError(`gate.decide decision must be "approve" or "reject": ${String(input.decision)}`, {
        code: 'VALIDATION',
        field: 'decision',
      })
    }
    const routeId = input.routeId
    const args = { routeId, node: input.node, note: input.note, nextNode: input.nextNode, ...ctx.session.beadsOptions() }
    const route = await ctx.session.mutate(() =>
      input.decision === 'approve' ? approveRouteGate(root, args) : rejectRouteGate(root, args),
    )
    await ctx.broadcaster.emit(routeId)
    return ok('gate.decide', { route })
  })

  bus.register('discuss.post', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { taskId?: string; message?: string; author?: 'user' | 'agent' }
    if (!input.taskId) throw new EngineError('discuss.post requires a taskId', { code: 'VALIDATION', field: 'taskId' })
    if (!input.message) throw new EngineError('discuss.post requires a message', { code: 'VALIDATION', field: 'message' })
    const taskId = input.taskId
    const message = await ctx.session.mutate(() =>
      appendTaskDiscussionMessage(root, taskId, { content: input.message!, author: input.author ?? 'user' }, ctx.session.beadsOptions()),
    )
    return ok('discuss.post', { message })
  })

  bus.register('discuss.list', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { taskId?: string }
    if (!input.taskId) throw new EngineError('discuss.list requires a taskId', { code: 'VALIDATION', field: 'taskId' })
    const discussion = await readTaskDiscussionMessages(root, input.taskId, ctx.session.beadsOptions())
    return ok('discuss.list', { discussion })
  })
}
