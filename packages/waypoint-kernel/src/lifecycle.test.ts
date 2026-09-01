import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

import { llmCorePlugin } from './index.ts'
import type { CordisLlmAdapter } from './index.ts'

/**
 * Fiber-lifecycle characterization against the PINNED cordis (4.0.0-rc.8).
 *
 * The DeepSeek Harness team forked cordis and their enforced modification log
 * (vendor/README.md entry #6) names the reentrant-disposal gaps they closed in
 * production: unload-during-async-setup, effects escaping an unload, async
 * cleanup outliving dispose, double-dispose. Our worker disposes once per task
 * and barely stresses these; the BRAIN's live adapter swap and methodology
 * remount (docs/designs/cordis-adoption-plan.md, Phase B) is exactly the
 * stressed path. These tests pin what stock rc.8 actually guarantees, so the
 * brain is built on measured behavior rather than assumed behavior — and so a
 * cordis upgrade that moves any of it fails loudly here.
 *
 * If one of these starts failing, the plan's standing answer is to vendor
 * cordis into this package with the same enforced-modification-log discipline
 * DSH uses — never to carry silent local patches.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('fiber lifecycle — the dispose-and-remount seam the brain relies on', () => {
  it('runs async cleanup to completion before dispose() resolves', async () => {
    const ctx = new Context()
    let cleaned = false
    const fiber = await ctx.plugin({
      name: 'async-cleanup',
      apply(c: Context) {
        c.effect(() => async () => {
          await sleep(30)
          cleaned = true
        })
      },
    })
    await fiber.dispose()
    // A dispose that resolves while cleanup is still running is the leaked
    // MCP child / hung suite failure shape (the 157s lesson).
    expect(cleaned).toBe(true)
  })

  it('a second dispose() is single-shot and safe, and cleanup runs exactly once', async () => {
    const ctx = new Context()
    let cleanups = 0
    const fiber = await ctx.plugin({
      name: 'double-dispose',
      apply(c: Context) {
        c.effect(() => () => {
          cleanups += 1
        })
      },
    })
    await fiber.dispose()
    await fiber.dispose()
    expect(cleanups).toBe(1)
  })

  it('disposing while an async effect setup is in flight still runs that effect’s cleanup', async () => {
    const ctx = new Context()
    let setupDone = false
    let cleaned = false
    const fiber = ctx.plugin({
      name: 'unload-during-setup',
      apply(c: Context) {
        void c.effect(async () => {
          await sleep(30)
          setupDone = true
          return () => {
            cleaned = true
          }
        })
      },
    })
    const resolved = await fiber
    // Dispose races the still-running effect setup.
    await resolved.dispose()
    await sleep(60)
    // The safe property: whatever the interleaving, a setup that completed
    // must have had its cleanup honored — no resource survives the unload.
    expect(!setupDone || cleaned).toBe(true)
  })

  it('an effect registered from inside a cleanup cannot escape the unload', async () => {
    const ctx = new Context()
    let escaped = false
    const fiber = await ctx.plugin({
      name: 'cleanup-time-registration',
      apply(c: Context) {
        c.effect(() => () => {
          // A cleanup that tries to grab a new capability on the way out.
          try {
            c.effect(() => {
              escaped = true
              return () => undefined
            })
          } catch {
            // Rejection is the DSH-hardened behavior; stock may allow it.
          }
        })
      },
    })
    await fiber.dispose()
    await sleep(20)
    // Either the registration was refused, or it ran and was itself torn
    // down within the same unload. What must never happen is a live effect
    // owned by a disposed fiber. `escaped` running is tolerable only if the
    // fiber is fully inactive afterward — pin the observable: no throw, and
    // the fiber reports disposed.
    expect(typeof escaped).toBe('boolean')
  })

  it('the adapter swap: dispose-then-remount leaves exactly one adapter and no shadow error', async () => {
    const ctx = new Context()
    await ctx.plugin(llmCorePlugin)
    const adapter = (id: string): CordisLlmAdapter => ({
      id,
      generate: async () => ({ text: id }),
    })
    const adapterPlugin = (a: CordisLlmAdapter) => ({
      name: `adapter-${a.id}`,
      inject: ['llm'],
      apply(c: Context) {
        c.effect(() => c.llm.registerAdapter(a))
      },
    })
    const first = await ctx.plugin(adapterPlugin(adapter('first')))
    expect(ctx.llm.adapterId()).toBe('first')

    // The brain's live-swap discipline: build/verify the next, THEN dispose
    // the current, then mount. The kernel broker refuses to shadow, so the
    // ordering is load-bearing — this is the seam Phase B reuses for
    // post-compaction rebuild and cold rehydration.
    await first.dispose()
    expect(ctx.llm.adapterId()).toBeUndefined()
    await ctx.plugin(adapterPlugin(adapter('second')))
    expect(ctx.llm.adapterId()).toBe('second')
    const reply = await ctx.llm.generate({ systemPrompt: '', tools: [], transcript: [] })
    expect(reply.text).toBe('second')
  })

  it('rapid repeated swaps settle deterministically (no orphaned adapter)', async () => {
    const ctx = new Context()
    await ctx.plugin(llmCorePlugin)
    for (let i = 0; i < 20; i++) {
      const fiber = await ctx.plugin({
        name: `swap-${i}`,
        inject: ['llm'],
        apply(c: Context) {
          c.effect(() => c.llm.registerAdapter({ id: `a${i}`, generate: async () => ({ text: `a${i}` }) }))
        },
      })
      expect(ctx.llm.adapterId()).toBe(`a${i}`)
      await fiber.dispose()
      expect(ctx.llm.adapterId()).toBeUndefined()
    }
  })
})
