import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

interface Task {
  id: string
  kind: string
}

describe('engine-host gate + discussion commands (folder)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('decides a gate (approve) using node and keeps the route active', async () => {
    const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as {
      route: { id: string; current_node: string | null }
    }
    const node = started.route.current_node ?? 'phase-1'
    expect(await host.dispatch('gate.decide', { routeId: started.route.id, node, decision: 'approve' })).toMatchObject({
      ok: true,
      action: 'gate.decide',
      route: { status: 'active' },
    })
  })

  it('rejects an invalid gate decision value', async () => {
    const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as {
      route: { id: string; current_node: string | null }
    }
    expect(
      await host.dispatch('gate.decide', {
        routeId: started.route.id,
        node: started.route.current_node ?? 'x',
        decision: 'maybe',
      }),
    ).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION', field: 'decision' } })
  })

  it('posts and lists a task-scoped discussion message', async () => {
    await host.dispatch('run.start', { quest: 'waypoint' })
    const tasks = (await host.dispatch('tasks.list', {})) as unknown as { tasks: Task[] }
    const discussionTask = tasks.tasks.find((t) => t.kind === 'discussion')
    expect(discussionTask, 'waypoint quest should materialize a discussion task').toBeDefined()

    const posted = await host.dispatch('discuss.post', { taskId: discussionTask!.id, message: 'clarify the objective' })
    expect(posted).toMatchObject({ ok: true, action: 'discuss.post' })

    const listed = (await host.dispatch('discuss.list', { taskId: discussionTask!.id })) as unknown as {
      ok: boolean
      discussion: { total: number; items: Array<{ content: string }> }
    }
    expect(listed.ok).toBe(true)
    expect(listed.discussion.total).toBe(1)
    expect(listed.discussion.items[0].content).toBe('clarify the objective')
  })

  it('requires a routeId and a valid decision for gate.decide', async () => {
    expect(await host.dispatch('gate.decide', { node: 'x', decision: 'approve' })).toMatchObject({
      ok: false,
      details: { code: 'VALIDATION', field: 'routeId' },
    })
  })
})
