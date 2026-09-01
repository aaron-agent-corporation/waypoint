// Item 53: the pi runtime is retired for workers (cordis-only). These are the
// retired path's own tests — run under the documented escape, never in product.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import { PiRecipeRuntime, type PiModelResolver } from './pi-runtime.ts'

/**
 * These tests drive the loop with a FAKE, model-free stream (no credentials).
 * The real ModelRuntime path is proven in docs/spikes/pi-runtime/real-turn-spike.mjs;
 * here we isolate outcome derivation, the report-claim seam, and enforcement.
 */

type Turn = { readonly tool: string; readonly args: Record<string, unknown> } | { readonly text: string }

/** A resolver whose streamSimple replays a fixed script of assistant turns. */
function scriptedResolver(turns: readonly Turn[], opts: { auth?: boolean; model?: boolean } = {}): PiModelResolver {
  let i = 0
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  return {
    hasConfiguredAuth: () => opts.auth ?? true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getModel: (provider, modelId) => (opts.model === false ? undefined : ({ provider, modelId, id: modelId, api: 'openai-completions' } as any)),
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

const REGISTRY = { anthropic: { auth: 'subscription' as const } }
const TARGETS = { high: { provider: 'anthropic', model: 'claude-x' } }

async function projectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-runtime-'))
}

const baseInput = (projectRoot: string) => ({ routeId: 'route-1', taskId: 'task-1', recipe: 'demo', prompt: 'do the thing', projectRoot })

describe('PiRecipeRuntime — outcome derivation + report claim (rsc-tka)', () => {
  it('submit_report(finished) -> finished, and the rsc-452 claim is on disk', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ tool: 'submit_report', args: { status: 'finished', summary: 'built it' } }]),
    })
    const out = await runtime.runRecipe(baseInput(root))

    expect(out.status).toBe('finished')
    expect(out.close_reason).toBe('built it')
    expect(out.provider).toBe('anthropic')
    expect(out.model).toBe('claude-x')
    const claim = JSON.parse(await readFile(join(root, '.waypoint', 'claims', 'route-1', 'task-1.json'), 'utf8')) as { task_id: string; status: string }
    expect(claim).toMatchObject({ task_id: 'task-1', status: 'finished' })
  })

  it('submit_report(failed) -> failed, carrying the agent claim (a claim is not a verdict)', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ tool: 'submit_report', args: { status: 'failed', summary: 'inputs missing' } }]),
    })
    const out = await runtime.runRecipe(baseInput(root))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('inputs missing')
  })

  it('an ALREADY-aborted signal is `stopped`, not `failed` — a deliberate stop is not a broken worker', async () => {
    // addEventListener('abort') never fires on a signal that is already
    // aborted, so seeding `aborted` from the listener alone misses every
    // cancellation that lands before the runtime is entered — and the run is
    // reported as "ended without a report", i.e. a broken worker rather than a
    // stop somebody asked for. `worker-spawn.ts` already got this right by
    // checking `signal?.aborted` up front; the in-process pi loop did not.
    const root = await projectRoot()
    const controller = new AbortController()
    controller.abort()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ text: 'never reached' }]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), signal: controller.signal })
    expect(out.status).toBe('stopped')
    expect(out.close_reason).toBe('run aborted')
  })

  it('the run ending without a report -> failed (the report contract is mandatory)', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ text: 'all done!' }]), // stops with no tool call
    })
    const out = await runtime.runRecipe(baseInput(root))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('submit_report was never called')
  })
})

describe('PiRecipeRuntime — model routing (rsc-bpg) (rsc-tka)', () => {
  it('FAILS CLOSED when the class routes to an unregistered provider', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: {}, // empty registry: nothing resolves
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ tool: 'submit_report', args: { status: 'finished', summary: 'x' } }]),
    })
    const out = await runtime.runRecipe(baseInput(root))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('model routing failed')
  })

  it('FAILS when the provider has no configured auth (told to run pi /login)', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ text: 'x' }], { auth: false }),
    })
    const out = await runtime.runRecipe(baseInput(root))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('no configured auth')
  })
})

describe('PiRecipeRuntime — tools + enforcement (rsc-tka)', () => {
  it('grants a recipe tool and lets it run, then finishes on submit_report', async () => {
    const root = await projectRoot()
    let ran = false
    const readTool: AgentTool = {
      name: 'read_note',
      label: 'Read note',
      description: 'read',
      parameters: Type.Object({}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (async () => { ran = true; return { content: [{ type: 'text', text: 'note' }], details: {} } }) as any,
    }
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      toolRegistry: { read_note: readTool },
      resolverFactory: async () =>
        scriptedResolver([
          { tool: 'read_note', args: {} },
          { tool: 'submit_report', args: { status: 'finished', summary: 'read then reported' } },
        ]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['read_note'] })
    expect(ran).toBe(true)
    expect(out.status).toBe('finished')
  })

  it('FAILS CLOSED when a recipe grants a tool not in the vetted registry', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      resolverFactory: async () => scriptedResolver([{ text: 'x' }]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['not_a_real_tool'] })
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('not in the vetted tool registry')
  })

  it('the Console policy seam can DENY a granted tool — blocked, its body never runs', async () => {
    const root = await projectRoot()
    let ran = false
    const dangerous: AgentTool = {
      name: 'shell',
      label: 'Shell',
      description: 'run',
      parameters: Type.Object({ cmd: Type.String() }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (async () => { ran = true; return { content: [{ type: 'text', text: 'ran' }], details: {} } }) as any,
    }
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      toolRegistry: { shell: dangerous },
      policy: (ctx) => (ctx.toolCall?.name === 'shell' ? { block: true, reason: 'policy: shell denied' } : undefined),
      resolverFactory: async () =>
        scriptedResolver([
          { tool: 'shell', args: { cmd: 'rm -rf /' } },
          { tool: 'submit_report', args: { status: 'finished', summary: 'reported despite the block' } },
        ]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['shell'] })
    expect(ran, 'the denied tool body executed — the policy seam did not block').toBe(false)
    expect(out.blocked_tools).toContain('shell')
    expect(out.status).toBe('finished')
  })

  it('config-driven pi_policy rules DENY a granted tool through the loop (rsc-bhc part 3)', async () => {
    const root = await projectRoot()
    let ran = false
    const dangerous: AgentTool = {
      name: 'shell',
      label: 'Shell',
      description: 'run',
      parameters: Type.Object({ cmd: Type.String() }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: (async () => { ran = true; return { content: [{ type: 'text', text: 'ran' }], details: {} } }) as any,
    }
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      toolRegistry: { shell: dangerous },
      // No inline `policy` — the runtime builds it from these config rules.
      piPolicy: [{ tool: 'shell', reason: 'no shell in this project' }],
      resolverFactory: async () =>
        scriptedResolver([
          { tool: 'shell', args: { cmd: 'rm -rf /' } },
          { tool: 'submit_report', args: { status: 'finished', summary: 'reported despite the block' } },
        ]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['shell'] })
    expect(ran, 'the config-driven deny rule did not block the tool body').toBe(false)
    expect(out.blocked_tools).toContain('shell')
    expect(out.status).toBe('finished')
  })
})

describe('PiRecipeRuntime — built-in access-map fs tools, in-process/in-jail (rsc-bhc)', () => {
  const ROOTS = { work: { path: 'work', access: 'rw' as const } }
  // alreadyJailed: these exercise the in-process fs-tool loop directly — the same
  // loop the jailed child runs. Without it a fs-tool grant would A′-fork to a real
  // jailed subprocess (rsc-0fx), which a scripted resolver cannot cross.

  it('grants read_file + write_file confined to the access map, and the write lands on disk', async () => {
    const root = await projectRoot()
    await mkdir(join(root, 'work'), { recursive: true })
    await writeFile(join(root, 'work', 'in.txt'), 'the-input', 'utf8')
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      roots: ROOTS,
      alreadyJailed: true,
      resolverFactory: async () =>
        scriptedResolver([
          { tool: 'read_file', args: { path: 'work/in.txt' } },
          { tool: 'write_file', args: { path: 'work/out.txt', content: 'the-output' } },
          { tool: 'submit_report', args: { status: 'finished', summary: 'read then wrote' } },
        ]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['read_file', 'write_file'], access: { work: 'rw' } })
    expect(out.status).toBe('finished')
    expect(await readFile(join(root, 'work', 'out.txt'), 'utf8')).toBe('the-output')
  })

  it('FAILS CLOSED when a recipe grants an fs tool but the plan declares no access map', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      roots: ROOTS,
      alreadyJailed: true,
      resolverFactory: async () => scriptedResolver([{ text: 'x' }]),
    })
    // no `access` on the input -> resolveAccessRoots refuses -> no tool built.
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['read_file'] })
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('in-process fs tools refused')
  })

  it('FAILS CLOSED when a recipe grants write_file but the access map names an undeclared root', async () => {
    const root = await projectRoot()
    const runtime = new PiRecipeRuntime({
      registry: REGISTRY,
      modelTargets: TARGETS,
      roots: ROOTS,
      alreadyJailed: true,
      resolverFactory: async () => scriptedResolver([{ text: 'x' }]),
    })
    const out = await runtime.runRecipe({ ...baseInput(root), tools: ['write_file'], access: { ghost: 'rw' } })
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('in-process fs tools refused')
  })
})
