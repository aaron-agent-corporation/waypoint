import { describe, expect, it } from 'vitest'

import { classifyRoute } from './reap.ts'

/**
 * rsc-jtm — the reap safety policy, in isolation. The danger of reaping is
 * killing a run that is legitimately parked (a human gate, a pending timer) or
 * one that is merely mid-dispatch. These tests pin exactly which parked states
 * are reapable so a future edit cannot loosen the policy silently.
 */
describe('classifyRoute (rsc-jtm reap policy)', () => {
  const STALE = 24

  it('reaps a recipe-parked route idle past the threshold', () => {
    const v = classifyRoute({ engineStatus: 'running', parkedKind: 'recipe', ageHours: 67, staleHours: STALE })
    expect(v.reapable).toBe(true)
    expect(v.classification).toContain('abandoned')
  })

  it('NEVER reaps a route parked at a human gate, however stale', () => {
    const v = classifyRoute({ engineStatus: 'running', parkedKind: 'gate', ageHours: 1000, staleHours: STALE })
    expect(v.reapable, 'a run awaiting a human decision must never be reaped by age').toBe(false)
    expect(v.classification).toContain('gate')
  })

  it('NEVER reaps a route waiting on a timer/landmark/delay, however stale', () => {
    for (const kind of ['wait', 'timer', 'delay'] as const) {
      const v = classifyRoute({ engineStatus: 'running', parkedKind: kind, ageHours: 1000, staleHours: STALE })
      expect(v.reapable, `a ${kind} fires in-database and must not be reaped`).toBe(false)
    }
  })

  it('keeps a recipe-parked route that is still fresh — it may be mid-dispatch', () => {
    const v = classifyRoute({ engineStatus: 'running', parkedKind: 'recipe', ageHours: 2, staleHours: STALE })
    expect(v.reapable).toBe(false)
    expect(v.classification).toContain('fresh')
  })

  it('reaps a route that never advanced to any node (pending engine, abandoned at birth)', () => {
    // The in-vivo shape: startQuestRoute created the instance, no bridge ever
    // picked it up, so engine is 'pending' with no current node. Stale = leaked.
    const v = classifyRoute({ engineStatus: 'pending', parkedKind: null, ageHours: 100, staleHours: STALE })
    expect(v.reapable).toBe(true)
    expect(v.classification).toContain('never advanced')
  })

  it('reaps at exactly the threshold (>=), not just beyond it', () => {
    expect(classifyRoute({ engineStatus: 'running', parkedKind: 'recipe', ageHours: 24, staleHours: 24 }).reapable).toBe(true)
    expect(classifyRoute({ engineStatus: 'running', parkedKind: 'recipe', ageHours: 23.9, staleHours: 24 }).reapable).toBe(false)
  })

  it('does not reap a pending-engine recipe route that is fresh, but does when stale', () => {
    expect(classifyRoute({ engineStatus: 'pending', parkedKind: 'recipe', ageHours: 1, staleHours: STALE }).reapable).toBe(false)
    expect(classifyRoute({ engineStatus: 'pending', parkedKind: 'recipe', ageHours: 99, staleHours: STALE }).reapable).toBe(true)
  })

  it('flags — but does not reap — a route whose engine is already terminal (a different leak)', () => {
    for (const engineStatus of ['completed', 'cancelled', 'failed']) {
      const v = classifyRoute({ engineStatus, parkedKind: 'recipe', ageHours: 99, staleHours: STALE })
      expect(v.reapable, 'cancel cannot help an already-terminal engine').toBe(false)
      expect(v.classification).toContain('stale')
    }
  })

  it('keeps a route with no engine instance (never started durably)', () => {
    expect(classifyRoute({ engineStatus: null, parkedKind: 'recipe', ageHours: 99, staleHours: STALE }).reapable).toBe(false)
  })

  it('reaps a stale non-self-resolving park (checkpoint/handoff/discussion should have completed long ago)', () => {
    // These auto-complete or are bridge-driven; stuck stale means abandoned, not
    // legitimately waiting. The protected set is the self-resolving waits only.
    for (const kind of ['checkpoint', 'handoff', 'discussion', 'node', 'artifact'] as const) {
      expect(classifyRoute({ engineStatus: 'running', parkedKind: kind, ageHours: 999, staleHours: STALE }).reapable, `${kind} stale`).toBe(true)
    }
  })

  it('keeps ALL self-resolving waits however stale — the protected set is enumerated, not the reapable set', () => {
    for (const kind of ['gate', 'wait', 'timer', 'delay'] as const) {
      expect(classifyRoute({ engineStatus: 'running', parkedKind: kind, ageHours: 99999, staleHours: STALE }).reapable, `${kind}`).toBe(false)
    }
  })
})
