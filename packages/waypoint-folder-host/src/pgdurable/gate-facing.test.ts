import { describe, expect, it } from 'vitest'

import { gateFacingInGraph } from './bridge.ts'

/**
 * Which task owes the human gate its plain-language brief (Aaron 2026-08-14:
 * no approval reaches a gate without one). The task directly before the next
 * gate in wave order carries the requirement, unless some presented task
 * already briefed.
 */
describe('gateFacingInGraph', () => {
  // Route-115's shape: extract → stage → QC → human gate → commit.
  const pipeline = [
    { id: 'task-622', kind: 'recipe', wave: 10 },
    { id: 'task-623', kind: 'recipe', wave: 20 },
    { id: 'task-624', kind: 'recipe', wave: 30 },
    { id: 'task-625', kind: 'gate', wave: 40 },
    { id: 'task-626', kind: 'recipe', wave: 50 },
  ]
  const nobody = new Set<string>()

  it('the task directly before the gate carries the requirement', () => {
    expect(gateFacingInGraph(pipeline, 'task-624', nobody)).toBe(true)
  })

  it('earlier tasks do not — the one facing the gate does', () => {
    expect(gateFacingInGraph(pipeline, 'task-622', nobody)).toBe(false)
    expect(gateFacingInGraph(pipeline, 'task-623', nobody)).toBe(false)
  })

  it('a task after the last gate owes nothing', () => {
    expect(gateFacingInGraph(pipeline, 'task-626', nobody)).toBe(false)
  })

  it('an already-briefed presented task releases the requirement', () => {
    expect(gateFacingInGraph(pipeline, 'task-624', new Set(['task-623']))).toBe(false)
  })

  it('same-wave siblings before the gate each carry it', () => {
    const parallel = [
      { id: 'a', kind: 'recipe', wave: 10 },
      { id: 'b', kind: 'recipe', wave: 10 },
      { id: 'g', kind: 'gate', wave: 20 },
    ]
    expect(gateFacingInGraph(parallel, 'a', nobody)).toBe(true)
    expect(gateFacingInGraph(parallel, 'b', nobody)).toBe(true)
  })

  it('a mute step between task and gate does not release the requirement', () => {
    // Route-118's shape: integrate (agent) → coverage sensors (deterministic,
    // no report seam) → human gate. Adjacency put the requirement on the
    // sensor step — on nobody — and the gate opened briefless again.
    const layer = [
      { id: 'integrate', kind: 'recipe', wave: 6 },
      { id: 'sensors', kind: 'recipe', wave: 7 },
      { id: 'review', kind: 'gate', wave: 8 },
    ]
    const mute = new Set(['sensors'])
    expect(gateFacingInGraph(layer, 'integrate', nobody, mute)).toBe(true)
    // The mute step itself still never carries it its own admission would
    // reject a report it cannot write — but the bridge never passes
    // gateFacing to a deterministic runtime at all; the graph rule simply
    // must not rely on it.
    expect(gateFacingInGraph(layer, 'sensors', nobody, mute)).toBe(true)
  })

  it('checkpoints and waits never release the requirement either', () => {
    const graph = [
      { id: 'work', kind: 'recipe', wave: 1 },
      { id: 'note', kind: 'checkpoint', wave: 2 },
      { id: 'g', kind: 'gate', wave: 3 },
    ]
    expect(gateFacingInGraph(graph, 'work', nobody)).toBe(true)
  })

  it('a quest with no gate demands nothing', () => {
    const flat = [
      { id: 'a', kind: 'recipe', wave: 10 },
      { id: 'b', kind: 'recipe', wave: 20 },
    ]
    expect(gateFacingInGraph(flat, 'b', nobody)).toBe(false)
  })

  it('an unknown task or an unwaved graph fails open', () => {
    expect(gateFacingInGraph(pipeline, 'task-999', nobody)).toBe(false)
    expect(gateFacingInGraph([{ id: 'a', kind: 'recipe', wave: null }], 'a', nobody)).toBe(false)
  })
})
