import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CordisRecipeRuntime } from './cordis-runtime.ts'
import type { PiAiResolver } from './cordis/llm-pi-ai.ts'
import type { RecipeManifest } from '@waypoint/core'

/**
 * Outcome derivation, driven by a FAKE model stream — no credentials, no
 * network. The composition itself is proven against the real MCP server in
 * cordis/cordis-worker.test.ts; what is isolated here is the rule that matters
 * most after the 2026-05-06 fabrication incident:
 *
 *   THE HOST DECIDES. A terminal condition beats the claim, and a run with no
 *   claim at all is `failed` no matter how the model chose to sign off.
 */

const TOOL_SERVER = join(import.meta.dirname, 'cordis', '__fixtures__', 'test-mcp-server.ts')

/** A resolver whose stream replays one fixed assistant turn. */
function scriptedResolver(turn: { text?: string } = { text: 'done' }): () => Promise<PiAiResolver> {
  return async () => ({
    hasConfiguredAuth: () => true,
    getModel: () => ({ id: 'fake' }),
    async *streamSimple() {
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: turn.text ?? '' }],
          stopReason: 'stop',
        },
      }
    },
  })
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cordis-runtime-'))
  await mkdir(join(root, 'case', 'reference'), { recursive: true })
  await mkdir(join(root, 'skills'), { recursive: true })
  await writeFile(join(root, 'case', 'reference', 'vocabulary.md'), '# Case vocabulary\n')
  await writeFile(join(root, 'skills', 'cite-discipline.md'), 'Pin-cite everything.\n')
  return root
}

const recipe: RecipeManifest = {
  schema_version: 1,
  slug: 'extractor',
  name: 'Extractor',
  prompt: 'You process the project inputs.',
  runtime: { kind: 'cordis', model_class: 'medium', tool_group: 'one' },
  skills: ['cite-discipline'],
  references: ['reference/vocabulary.md'],
  tools: ['alpha'],
} as RecipeManifest

function runtimeFor(over: Record<string, unknown> = {}): CordisRecipeRuntime {
  return new CordisRecipeRuntime({
    registry: { openrouter: { kind: 'api_key' } } as never,
    modelTargets: { medium: { provider: 'openrouter', model: 'test/model' } } as never,
    roots: { case: { path: 'case' }, skills: { path: 'skills' } } as never,
    toolServer: TOOL_SERVER,
    resolverFactory: scriptedResolver(),
    env: process.env,
    ...over,
  })
}

function input(projectRoot: string, over: Record<string, unknown> = {}) {
  return {
    routeId: 'r1',
    taskId: 't1',
    recipe,
    prompt: 'Do the thing.',
    projectRoot,
    access: { case: 'ro', skills: 'ro' },
    ...over,
  } as never
}

describe('CordisRecipeRuntime — the turn budget', () => {
  it("uses the recipe's max_turns and reports exhaustion as `exhausted`, never `finished`", async () => {
    const root = await project()
    // A model that never stops calling a tool: the only thing that can end this
    // run is the budget, so the budget is what the outcome must name.
    const looping: () => Promise<PiAiResolver> = async () => ({
      hasConfiguredAuth: () => true,
      getModel: () => ({ id: 'fake' }),
      async *streamSimple() {
        yield {
          type: 'done',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'c1', name: 'alpha', arguments: {} }],
            stopReason: 'toolUse',
          },
        }
      },
    })
    const output = await runtimeFor({ resolverFactory: looping }).runRecipe(
      input(root, { recipe: { ...recipe, runtime: { ...recipe.runtime, max_turns: 3 } } }),
    )
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('all 3 turns')
  })
})

describe('CordisRecipeRuntime — outcome discipline', () => {
  it('fails a run that ended without a report, however the model signed off', async () => {
    const root = await project()
    const output = await runtimeFor().runRecipe(input(root))
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('never filed a claim')
    // Both endings were prose, so the record says the nudge was spent too —
    // the operator should never wonder whether the safety net was tried.
    expect(output.close_reason).toContain('even after the report nudge')
    expect(output.runtime).toBe('cordis')
  })

  it('a prose sign-off gets ONE nudge, and a report on the nudged turn finishes the run', async () => {
    // Witnessed live (item 54, 2026-08-30): a small-codex worker on a
    // multi-tool closed surface does the work, then signs off in text without
    // calling `report`. The nudge turns that from a claimless failure into a
    // filed claim.
    const root = await project()
    let calls = 0
    const proseThenReport: () => Promise<PiAiResolver> = async () => ({
      hasConfiguredAuth: () => true,
      getModel: () => ({ id: 'fake' }),
      async *streamSimple() {
        calls += 1
        yield calls === 1
          ? {
              type: 'done',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'All done, everything looks great!' }],
                stopReason: 'stop',
              },
            }
          : {
              type: 'done',
              message: {
                role: 'assistant',
                content: [
                  {
                    type: 'toolCall',
                    id: 'c-report',
                    name: 'report',
                    arguments: { status: 'finished', summary: 'nudged into filing' },
                  },
                ],
                stopReason: 'toolUse',
              },
            }
      },
    })
    const output = await runtimeFor({ resolverFactory: proseThenReport }).runRecipe(input(root))
    expect(calls).toBe(2)
    expect(output.status).toBe('finished')
  })

  it('puts the composition digest on the record even on a failure', async () => {
    const root = await project()
    const output = await runtimeFor().runRecipe(input(root))
    expect(output.composition_digest).toMatch(/^[0-9a-f]{16}$/)
  })

  it('reports the same digest for two dispatches of one recipe', async () => {
    const root = await project()
    const a = await runtimeFor().runRecipe(input(root))
    const b = await runtimeFor().runRecipe(input(root, { taskId: 't2', prompt: 'Something else entirely.' }))
    expect(a.composition_digest).toBe(b.composition_digest)
  })

  it('fails closed when the model class maps to nothing, without reaching a model', async () => {
    const root = await project()
    const output = await runtimeFor({ modelTargets: {} }).runRecipe(input(root))
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('model routing failed')
    expect(output.composition_digest).toBeNull()
  })

  it('surfaces a composition refusal as a failed attempt naming the cause', async () => {
    const root = await project()
    const output = await runtimeFor().runRecipe(
      input(root, { recipe: { ...recipe, skills: ['no-such-skill'] } }),
    )
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('composition refused')
    expect(output.close_reason).toContain('no-such-skill')
  })

  it('reports `stopped` when the dispatch is aborted, never `finished`', async () => {
    const root = await project()
    const controller = new AbortController()
    controller.abort()
    const output = await runtimeFor().runRecipe(input(root, { signal: controller.signal }))
    expect(output.status).toBe('stopped')
    expect(output.close_reason).toBe('run aborted')
  })

  it('reports `finished` only when a claim on disk says so', async () => {
    const root = await project()
    await mkdir(join(root, '.waypoint', 'claims', 'r1'), { recursive: true })
    await writeFile(
      join(root, '.waypoint', 'claims', 'r1', 't1.json'),
      JSON.stringify({ status: 'finished', summary: '8 widgets processed' }),
    )
    const output = await runtimeFor().runRecipe(input(root))
    expect(output.status).toBe('finished')
    expect(output.close_reason).toBe('8 widgets processed')
  })

  it('fails when the claim says anything other than finished', async () => {
    const root = await project()
    await mkdir(join(root, '.waypoint', 'claims', 'r1'), { recursive: true })
    await writeFile(
      join(root, '.waypoint', 'claims', 'r1', 't1.json'),
      JSON.stringify({ status: 'blocked', summary: 'inputs missing' }),
    )
    const output = await runtimeFor().runRecipe(input(root))
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('inputs missing')
  })
})
