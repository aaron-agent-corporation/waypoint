import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { parseWaypointProjectConfig, recipeRuntimeProblem } from '../project/config.ts'
import {
  retiredWorkerHarnessProblem,
  workerLaneProviderProblem,
} from './cordis-only.ts'
import { CordisRecipeRuntime } from './cordis-runtime.ts'
import { WorkerRecipeRuntime } from './worker-runtime.ts'
import type { RecipeManifest } from '@waypoint-engine/core'

/**
 * Worker-harness fail-closed enforcement. A retired value FAILS, never warns,
 * never substitutes.
 */

const cleanups: string[] = []
afterAll(async () => {
  for (const dir of cleanups) await rm(dir, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-only-'))
  cleanups.push(dir)
  return dir
}

describe('retiredWorkerHarnessProblem — third-party harness commands refuse', () => {
  it.each([
    'claude -p',
    'claude',
    '/opt/homebrew/bin/claude --output-format json',
    'codex exec --json',
    'gemini',
    'aider --yes',
    'pi --mode agent',
    'npx claude -p',
    'pnpm dlx codex',
    'bunx aider',
  ])('refuses %j', (command) => {
    const problem = retiredWorkerHarnessProblem(command)
    expect(problem).toBeDefined()
    expect(problem).toContain('fails closed')
  })

  it.each([
    'node tools/quest-proving/fake-agent.mjs',
    'python3 scripts/fake-worker.py',
    './bin/my-firm-agent',
    'npx some-build-tool',
    '',
    '   ',
  ])('passes %j — not a known harness', (command) => {
    expect(retiredWorkerHarnessProblem(command)).toBeUndefined()
  })

  it('names the matched harness so the operator knows what was refused', () => {
    expect(retiredWorkerHarnessProblem('claude -p')).toContain("'claude'")
    expect(retiredWorkerHarnessProblem('npx codex')).toContain("'codex'")
  })
})

describe('workerLaneProviderProblem — Anthropic never rides a worker lane', () => {
  it('refuses anthropic, case-insensitively', () => {
    for (const provider of ['anthropic', 'Anthropic', 'ANTHROPIC']) {
      const problem = workerLaneProviderProblem(provider)
      expect(problem).toBeDefined()
      expect(problem).toContain('never rides a worker lane')
      expect(problem).toContain('api_key provider')
    }
  })

  it('passes every other provider untouched', () => {
    for (const provider of ['openai-codex', 'xai', 'kimi', 'openrouter', 'ollama']) {
      expect(workerLaneProviderProblem(provider)).toBeUndefined()
    }
  })
})

describe('parse-time refusal (the fail-closed pattern)', () => {
  it('a config naming a retired harness command fails at parse', () => {
    const yaml = [
      'schema_version: 1',
      'enabled: true',
      'quest: runner',
      'runtime:',
      '  recipe: worker',
      '  worker:',
      '    command: claude -p',
    ].join('\n')
    expect(() => parseWaypointProjectConfig(yaml)).toThrow(/third-party agent harness/)
  })

  it('a benign worker command still parses', () => {
    const yaml = [
      'schema_version: 1',
      'enabled: true',
      'quest: runner',
      'runtime:',
      '  recipe: worker',
      '  worker:',
      '    command: node tools/quest-proving/fake-agent.mjs',
    ].join('\n')
    const config = parseWaypointProjectConfig(yaml)
    expect(config.runtime.worker?.command).toBe('node tools/quest-proving/fake-agent.mjs')
  })

  it('recipeRuntimeProblem re-checks programmatic configs (Q1 admission)', () => {
    const problem = recipeRuntimeProblem({ recipe: 'worker', worker: { command: 'codex' } } as never)
    expect(problem).toContain('third-party agent harness')
    expect(
      recipeRuntimeProblem({ recipe: 'worker', worker: { command: './bin/fake-agent' } } as never),
    ).toBeUndefined()
  })
})

describe('runtime backstops', () => {
  it('WorkerRecipeRuntime refuses a retired command at construction', () => {
    expect(
      () => new WorkerRecipeRuntime({ command: 'claude', args: ['-p'], roots: {} } as never),
    ).toThrow(/third-party agent harness/)
  })

  it('CordisRecipeRuntime fails an anthropic-resolved worker target with the ruling', async () => {
    const root = await tempRoot()
    const recipe = {
      slug: 'test-recipe',
      prompt: 'Do the thing.',
      runtime: { kind: 'cordis', model_class: 'medium' },
    } as RecipeManifest
    const runtime = new CordisRecipeRuntime({
      registry: { anthropic: { kind: 'api_key' } } as never,
      modelTargets: { medium: { provider: 'anthropic', model: 'claude-x' } } as never,
    } as never)
    const output = await runtime.runRecipe({
      routeId: 'r1',
      taskId: 't1',
      recipe,
      prompt: 'Do the thing.',
      projectRoot: root,
    } as never)
    expect(output.status).toBe('failed')
    expect(output.close_reason).toContain('never rides a worker lane')
  })
})
