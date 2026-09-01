// Item 53: the pi runtime is retired for workers (cordis-only). These are the
// retired path's own tests — run under the documented escape, never in product.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import type { PiModelResolver } from './pi-runtime.ts'
import { runPiWorkerChild, type PiWorkOrder } from './pi-worker-entry.ts'

/** A resolver whose streamSimple replays a fixed script (no credentials) —
 *  mirrors pi-runtime.test.ts so the child is exercised end-to-end sans model. */
type Turn = { readonly tool: string; readonly args: Record<string, unknown> } | { readonly text: string }
function scriptedResolver(turns: readonly Turn[]): PiModelResolver {
  let i = 0
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  return {
    hasConfiguredAuth: () => true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getModel: (provider, modelId) => ({ provider, modelId, id: modelId, api: 'openai-completions' } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamSimple: ((): any => {
      const turn = turns[Math.min(i++, turns.length - 1)]!
      const s = createAssistantMessageEventStream()
      const base = { role: 'assistant' as const, api: 'openai-completions', provider: 'fake', model: 'fake', usage, timestamp: 0 }
      const message =
        'text' in turn
          ? { ...base, content: [{ type: 'text', text: turn.text }], stopReason: 'stop' as const }
          : { ...base, content: [{ type: 'toolCall', id: `tc-${i}`, name: turn.tool, arguments: turn.args }], stopReason: 'toolUse' as const }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.push({ type: 'start', partial: message as any })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.push(('text' in turn ? { type: 'done', reason: 'stop', message } : { type: 'done', reason: 'toolUse', message }) as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.end(message as any)
      return s
    }) as PiModelResolver['streamSimple'],
  }
}

async function projectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-child-'))
}

const order = (root: string, extra: Partial<PiWorkOrder> = {}): PiWorkOrder => ({
  routeId: 'route-1',
  taskId: 'task-1',
  recipe: 'demo',
  prompt: 'do the thing',
  projectRoot: root,
  provider: 'openai-codex',
  model: 'gpt-5.4',
  ...extra,
})

describe('runPiWorkerChild — jailed pi worker child (rsc-0fx)', () => {
  it('routes to the parent-resolved (provider, model), runs, and writes the rsc-452 claim', async () => {
    const root = await projectRoot()
    const out = await runPiWorkerChild({
      order: order(root),
      resolverFactory: async () => scriptedResolver([{ tool: 'submit_report', args: { status: 'finished', summary: 'did it' } }]),
    })
    expect(out.status).toBe('finished')
    expect(out.provider).toBe('openai-codex')
    expect(out.model).toBe('gpt-5.4')
    const claim = JSON.parse(await readFile(join(root, '.waypoint', 'claims', 'route-1', 'task-1.json'), 'utf8')) as { status: string }
    expect(claim.status).toBe('finished')
  })

  it('grants the access-map fs tools and confines them (write lands in the rw root)', async () => {
    const root = await projectRoot()
    await mkdir(join(root, 'work'), { recursive: true })
    const out = await runPiWorkerChild({
      order: order(root, {
        tools: ['write_file'],
        access: { work: 'rw' },
        roots: { work: { path: 'work', access: 'rw' } },
      }),
      resolverFactory: async () =>
        scriptedResolver([
          { tool: 'write_file', args: { path: 'work/out.txt', content: 'jailed-write' } },
          { tool: 'submit_report', args: { status: 'finished', summary: 'wrote' } },
        ]),
    })
    expect(out.status).toBe('finished')
    expect(await readFile(join(root, 'work', 'out.txt'), 'utf8')).toBe('jailed-write')
  })

  it('FAILS CLOSED when no brokered credential is present (default resolver)', async () => {
    const root = await projectRoot()
    // no resolverFactory override + an env without the broker var -> the default
    // brokered factory throws -> PiRecipeRuntime fails the attempt closed.
    const out = await runPiWorkerChild({ order: order(root), env: {} })
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('brokered credential')
  })
})
