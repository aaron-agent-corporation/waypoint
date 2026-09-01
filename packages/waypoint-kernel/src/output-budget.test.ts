import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

import { outputBudgetPlugin, sliceSurrogateSafe, toolsCorePlugin } from './index.ts'

/**
 * The output budget's two modes (Phase C). Elision was the Phase A
 * behavior; spill is the upgrade: the FULL oversized output parks at a
 * real path in a writable scratch root and the transcript carries a
 * bounded preview plus that path — nothing is lost, and re-reading beats
 * re-running the tool. A failed spill degrades to elision, never to a
 * lost turn. Every cut goes through the surrogate-safe slicer.
 */

async function budgetedCtx(config: {
  maxChars: number
  spillDir?: string
  output: string
}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(toolsCorePlugin)
  await ctx.plugin(outputBudgetPlugin, {
    maxChars: config.maxChars,
    ...(config.spillDir !== undefined ? { spillDir: config.spillDir } : {}),
  })
  ctx.tools.register(
    { name: 'chatty_tool', description: 'returns a lot', parameters: { type: 'object' } },
    () => config.output,
  )
  return ctx
}

const call = { id: 'c1', name: 'chatty_tool', args: {} }

describe('outputBudgetPlugin — elision mode (no spill dir)', () => {
  it('leaves small outputs byte-identical', async () => {
    const ctx = await budgetedCtx({ maxChars: 1000, output: 'small enough' })
    const outcome = await ctx.tools.execute(call)
    expect(outcome.output).toBe('small enough')
  })

  it('clamps oversized output head+tail with a size-naming marker', async () => {
    const output = `HEAD${'m'.repeat(50_000)}TAIL`
    const ctx = await budgetedCtx({ maxChars: 1000, output })
    const outcome = await ctx.tools.execute(call)
    expect(outcome.status).toBe('ok')
    expect(outcome.output.length).toBeLessThanOrEqual(1000)
    expect(outcome.output).toContain('HEAD')
    expect(outcome.output).toContain('TAIL')
    expect(outcome.output).toContain(`output elided: ${output.length} chars total`)
  })
})

describe('outputBudgetPlugin — spill mode', () => {
  it('parks the full text at a real path and previews inline', async () => {
    const spillDir = await mkdtemp(join(tmpdir(), 'cordis-spill-'))
    const output = `HEAD${'m'.repeat(50_000)}TAIL`
    const ctx = await budgetedCtx({ maxChars: 1000, spillDir, output })
    const outcome = await ctx.tools.execute(call)

    expect(outcome.output.length).toBeLessThanOrEqual(1000)
    expect(outcome.output).toContain('output spilled')
    const match = outcome.output.match(/full text at (\S+);/)
    expect(match).not.toBeNull()
    const spillPath = match![1]!
    expect(spillPath.startsWith(spillDir)).toBe(true)
    expect(spillPath).toContain('chatty_tool')
    // Nothing is lost: the file holds the output verbatim.
    expect(await readFile(spillPath, 'utf8')).toBe(output)
  })

  it('degrades to elision when the spill dir is unwritable', async () => {
    const output = 'x'.repeat(50_000)
    const ctx = await budgetedCtx({
      maxChars: 1000,
      spillDir: '/nonexistent-root/definitely/not/writable',
      output,
    })
    const outcome = await ctx.tools.execute(call)
    expect(outcome.status).toBe('ok')
    expect(outcome.output.length).toBeLessThanOrEqual(1000)
    expect(outcome.output).toContain('output elided (spill unavailable)')
  })

  it('never splits a surrogate pair at either cut', async () => {
    const spillDir = await mkdtemp(join(tmpdir(), 'cordis-spill-'))
    const output = '💚'.repeat(30_000)
    const ctx = await budgetedCtx({ maxChars: 1001, spillDir, output })
    const outcome = await ctx.tools.execute(call)
    for (let i = 0; i < outcome.output.length; i++) {
      const code = outcome.output.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        const nextCode = outcome.output.charCodeAt(i + 1)
        expect(nextCode >= 0xdc00 && nextCode <= 0xdfff).toBe(true)
        i += 1
      } else {
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false)
      }
    }
  })
})

describe('sliceSurrogateSafe', () => {
  it('slides cut points off half surrogates', () => {
    expect(sliceSurrogateSafe('💚', 0, 1)).toBe('')
    expect(sliceSurrogateSafe('💚', 0, 2)).toBe('💚')
    expect(sliceSurrogateSafe('💚z', 1, 3)).toBe('z')
    expect(sliceSurrogateSafe('abcdef', 1, 4)).toBe('bcd')
  })
})
