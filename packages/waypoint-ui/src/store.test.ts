import { beforeEach, describe, expect, it } from 'vitest'

import type { AgentEventRecord, EngineWsMessage } from './engine/types'
import { useStore } from './store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function agentEvent(seq: number, sessionId: string, idx: number, kind = 'agent.message'): EngineWsMessage {
  const record: AgentEventRecord = { id: `ev-${idx}`, sessionId, kind, at: 't', idx }
  return { type: 'event', topic: `agent:${sessionId}`, seq, record }
}

function snapshot(seq: number, routeIds: string[]): EngineWsMessage {
  return {
    type: 'snapshot',
    apiVersion: '1',
    seq,
    routes: routeIds.map((id) => ({ id, quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' })),
    tasks: [],
  }
}

describe('store.applyMessage', () => {
  it('hydrates routes + tasks + seq from a snapshot and marks the connection open', () => {
    useStore.getState().applyMessage({
      type: 'snapshot',
      apiVersion: '1',
      seq: 5,
      routes: [{ id: 'route-001', quest: 'q', status: 'active', current_node: null, subject: { type: 'project', id: 'local' }, created_at: 't', updated_at: 't' }],
      tasks: [],
    })
    const s = useStore.getState()
    expect(s.seq).toBe(5)
    expect(s.routes).toHaveLength(1)
    expect(s.connection).toBe('open')
  })

  it('appends agent events to the right transcript and dedupes by idx', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(agentEvent(6, 'agent-001', 0))
    applyMessage(agentEvent(7, 'agent-001', 1))
    applyMessage(agentEvent(7, 'agent-001', 1)) // duplicate seq+idx
    expect(useStore.getState().transcripts['agent-001'].map((e) => e.idx)).toEqual([0, 1])
  })

  it('ignores stale (already-seen seq) events', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(agentEvent(10, 'agent-001', 0))
    applyMessage(agentEvent(9, 'agent-001', 1)) // stale
    expect(useStore.getState().transcripts['agent-001'].map((e) => e.idx)).toEqual([0])
  })

  it('bumps routesEpoch on a route event and again on resnapshot (so each change retriggers a refetch)', () => {
    const { applyMessage } = useStore.getState()
    const start = useStore.getState().routesEpoch
    applyMessage({ type: 'event', topic: 'route:route-001', seq: 3, record: { kind: 'route.started' } })
    expect(useStore.getState().routesEpoch).toBe(start + 1)
    applyMessage({ type: 'resnapshot' })
    expect(useStore.getState().routesEpoch).toBe(start + 2)
  })

  it('bumpRoutesEpoch advances the epoch (manual Retry / session-recovery nudge path)', () => {
    const start = useStore.getState().routesEpoch
    useStore.getState().bumpRoutesEpoch()
    expect(useStore.getState().routesEpoch).toBe(start + 1)
    useStore.getState().bumpRoutesEpoch()
    expect(useStore.getState().routesEpoch).toBe(start + 2)
  })

  it('rehydrates from a lower-seq snapshot and re-bases seq (engine restart / seq-reset recovery)', () => {
    const { applyMessage } = useStore.getState()
    applyMessage(snapshot(10, ['route-old']))
    expect(useStore.getState().seq).toBe(10)

    // Engine restarts → fresh authoritative snapshot with a LOWER seq + new state.
    applyMessage(snapshot(4, ['route-new']))
    let s = useStore.getState()
    expect(s.seq).toBe(4) // re-based to the new hub seq, not held at the stale 10
    expect(s.routes.map((r) => r.id)).toEqual(['route-new']) // rehydrated, not stranded
    expect(s.connection).toBe('open')

    // A post-restart event (seq > the re-based mark) now flows and drives a refetch.
    const epoch = useStore.getState().routesEpoch
    applyMessage({ type: 'event', topic: 'route:route-new', seq: 5, record: { kind: 'route.updated' } })
    s = useStore.getState()
    expect(s.routesEpoch).toBe(epoch + 1)
    expect(s.seq).toBe(5)
  })

  it('records an error frame into the store', () => {
    useStore.getState().applyMessage({ type: 'error', error: 'engine exploded' })
    expect(useStore.getState().error).toBe('engine exploded')
  })

  it('clears prior WS + routes errors when a fresh snapshot arrives (same-channel recovery)', () => {
    const { applyMessage, setRoutesError } = useStore.getState()
    applyMessage({ type: 'error', error: 'engine exploded' })
    setRoutesError('routes.list failed')
    applyMessage(snapshot(1, ['route-001']))
    const s = useStore.getState()
    expect(s.error).toBeNull()
    expect(s.routesError).toBeNull()
  })
})

import type { WaypointFolderTask } from './engine/types'
import type { Recipe } from './recipe'

const recipeTask = (id: string, slug: string): WaypointFolderTask => ({
  id, route_id: 'route-001', plan_ref: 'p', title: 't', phase: 'x', wave: 0,
  kind: 'recipe', status: 'open', created_at: 't', updated_at: 't',
  metadata: { waypoint: { recipe: { slug } } },
})
const checkpointTask = (id: string): WaypointFolderTask => ({
  id, route_id: 'route-001', plan_ref: 'p', title: 't', phase: 'x', wave: 0,
  kind: 'checkpoint', status: 'open', created_at: 't', updated_at: 't', metadata: {},
})

describe('store recipe state', () => {
  it('selectRecipe sets and clears the slug', () => {
    useStore.getState().selectRecipe('reviewer')
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
    useStore.getState().selectRecipe(null)
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })

  it('setRecipeScope flips the scope', () => {
    expect(useStore.getState().recipeScope).toBe('route')
    useStore.getState().setRecipeScope('all')
    expect(useStore.getState().recipeScope).toBe('all')
  })

  it('cache setters populate quest, global, and warnings', () => {
    const r: Recipe = { slug: 'reviewer', name: 'Reviewer' }
    useStore.getState().setQuestRecipes('waypoint', [r])
    expect(useStore.getState().recipesByQuest.waypoint).toEqual([r])
    useStore.getState().setAllRecipes([r], ['half-written.yaml: invalid Recipe manifest'])
    expect(useStore.getState().recipesAll).toEqual([r])
    expect(useStore.getState().recipesWarningsAll).toEqual(['half-written.yaml: invalid Recipe manifest'])
  })

  it('selectTask sets the recipe slug for a recipe node and clears it for a non-recipe node', () => {
    useStore.setState({ tasks: [recipeTask('task-1', 'reviewer'), checkpointTask('task-2')] })
    useStore.getState().selectTask('task-1')
    expect(useStore.getState().selectedTaskId).toBe('task-1')
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
    useStore.getState().selectTask('task-2')
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })

  it('selectRecipe clears selectedTaskId (rail selection is not task-scoped)', () => {
    useStore.setState({ selectedTaskId: 'task-1', selectedRecipeSlug: null })
    useStore.getState().selectRecipe('reviewer')
    expect(useStore.getState().selectedRecipeSlug).toBe('reviewer')
    expect(useStore.getState().selectedTaskId).toBeNull()
  })

  it('selectRoute clears both selectedTaskId and selectedRecipeSlug', () => {
    useStore.setState({ selectedTaskId: 'task-1', selectedRecipeSlug: 'reviewer' })
    useStore.getState().selectRoute('route-002')
    expect(useStore.getState().selectedRouteId).toBe('route-002')
    expect(useStore.getState().selectedTaskId).toBeNull()
    expect(useStore.getState().selectedRecipeSlug).toBeNull()
  })

  it('bumpRecipesEpoch advances the epoch (recipes banner Retry path)', () => {
    const start = useStore.getState().recipesEpoch
    useStore.getState().bumpRecipesEpoch()
    expect(useStore.getState().recipesEpoch).toBe(start + 1)
    useStore.getState().bumpRecipesEpoch()
    expect(useStore.getState().recipesEpoch).toBe(start + 2)
  })
})
