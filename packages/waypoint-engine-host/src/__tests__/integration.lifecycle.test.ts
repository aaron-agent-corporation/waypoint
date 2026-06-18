import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineClient } from '../client.ts'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, delay, makeTempDir } from './helpers/workspace.ts'

/**
 * End-to-end over the real HTTP+WS transport via the shipped client:
 * open → run.start → routes → events → gate → author → promote → approve.
 * The gate node is read from the started route (deterministic for the
 * `waypoint` quest) — no self-adjusting assertion.
 */
describe('engine-host full lifecycle (folder, over HTTP+WS)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  let url: string
  let token: string

  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    const started = await host.start()
    url = started.url
    token = started.token
  })
  afterEach(async () => {
    await host.stop()
    await cleanup(dir)
  })

  it('drives the full lifecycle through the client', async () => {
    const client = createEngineClient({ url, token })

    expect(await client.cmd('workspace.open', { root: dir, backend: 'folder' })).toMatchObject({ ok: true })

    // Subscribe before starting so we observe live deltas.
    const events: unknown[] = []
    const unsubscribe = await client.subscribe(['*'], (e) => events.push(e))

    const started = (await client.cmd('run.start', { quest: 'waypoint' })) as unknown as {
      ok: boolean
      route: { id: string; current_node: string | null }
    }
    expect(started.ok).toBe(true)
    const routeId = started.route.id

    const routes = (await client.cmd('routes.list')) as unknown as { routes: unknown[] }
    expect(routes.routes).toHaveLength(1)

    const eventsPage = (await client.cmd('route.events', { routeId })) as unknown as { events: unknown[] }
    expect(eventsPage.events.length).toBeGreaterThan(0)

    // Deterministic gate node from the started route.
    const node = started.route.current_node
    expect(node, 'waypoint quest should have a current node').toBeTruthy()
    const gate = await client.cmd('gate.decide', { routeId, node, decision: 'approve' })
    expect(gate).toMatchObject({ ok: true, route: { status: 'active' } })

    const draft = (await client.cmd('author.recipe', {
      spec: { slug: 'lifecycle-recipe', name: 'Lifecycle Recipe', prompt: 'work', source: { inspected_paths: ['src/index.ts'] } },
    })) as unknown as { ok: boolean; draft: { kind: string; path: string; yaml: string } }
    expect(draft.ok).toBe(true)

    const promoted = (await client.cmd('author.promote', { draft: draft.draft })) as unknown as {
      ok: boolean
      proposalId: string
    }
    expect(promoted).toMatchObject({ ok: true, proposalId: 'recipe/lifecycle-recipe' })

    const approved = await client.cmd('author.approveProposal', { id: promoted.proposalId })
    expect(approved).toMatchObject({ ok: true, path: 'recipes/lifecycle-recipe.yaml' })

    // Live deltas reached the subscriber across the run.
    for (let i = 0; i < 50 && events.length === 0; i += 1) await delay(20)
    expect(events.length).toBeGreaterThan(0)
    unsubscribe()
  })
})
