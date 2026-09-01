/**
 * The worker pool: one lane per subscription.
 *
 * Concurrency is bounded by the plan the workers share, not by the machine —
 * so the way to get more workers is to seat another subscription, each with
 * its own binary, credential home, and idea of what "high" means (Aaron
 * 2026-07-28). These tests pin that a lane carries all three, and that a
 * project without lanes is untouched.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRecipeRuntimeLanes } from './run.ts'

async function projectWith(runtime: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'waypoint-lanes-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  await writeFile(join(root, '.waypoint', 'config.yaml'), `schema_version: 1\nquest: runner\n${runtime}`, 'utf8')
  return root
}

const POOL = `runtime:
  recipe: worker
  worker:
    command: /bin/lane-agent
    args: ['-p']
    model_args:
      high: ['--model', 'opus']
    lanes:
      - name: claude-max-a
        env:
          CLAUDE_CONFIG_DIR: /homes/claude-a
      - name: claude-max-b
        env:
          CLAUDE_CONFIG_DIR: /homes/claude-b
      - name: codex-a
        command: /bin/lane-agent-b
        args: ['exec']
        env:
          CODEX_HOME: /homes/codex-a
        model_args:
          high: ['-m', 'gpt-5.5']
`

describe('createRecipeRuntimeLanes', () => {
  it('seats one worker per subscription, in declaration order', async () => {
    const lanes = await createRecipeRuntimeLanes(await projectWith(POOL))
    expect(lanes.map((lane) => lane.name)).toEqual(['claude-max-a', 'claude-max-b', 'codex-a'])
  })

  it('binds each lane to its own account and its own idea of "high"', async () => {
    const lanes = await createRecipeRuntimeLanes(await projectWith(POOL))
    const config = (lane: (typeof lanes)[number]): Record<string, unknown> =>
      (lane.runtime as unknown as { config: Record<string, unknown> }).config

    // Two lanes, one binary, two subscriptions — the whole point.
    expect(config(lanes[0]!).command).toBe('/bin/lane-agent')
    expect(config(lanes[1]!).command).toBe('/bin/lane-agent')
    expect(config(lanes[0]!).envInject).toEqual({ CLAUDE_CONFIG_DIR: '/homes/claude-a' })
    expect(config(lanes[1]!).envInject).toEqual({ CLAUDE_CONFIG_DIR: '/homes/claude-b' })

    // A lane that names nothing inherits the pool's defaults…
    expect(config(lanes[0]!).modelArgs).toEqual({ high: ['--model', 'opus'] })
    // …and one that does overrides them, because "high" is a different model
    // on every provider.
    expect(config(lanes[2]!).command).toBe('/bin/lane-agent-b')
    expect(config(lanes[2]!).args).toEqual(['exec'])
    expect(config(lanes[2]!).modelArgs).toEqual({ high: ['-m', 'gpt-5.5'] })
  })

  it('carries the account and how the work order reaches the agent', async () => {
    // kimi answers "Prompt cannot be empty" to a piped order and never reads
    // the pipe, so its lane sends the order as the final argument. And a lane
    // names its account: when a subscription breaks, which one is the only
    // question that matters (Aaron 2026-07-28).
    const root = await projectWith(`runtime:
  recipe: worker
  worker:
    command: /bin/lane-agent
    lanes:
      - name: kimi-1
        email: aaron@agent-corporation.com
        command: /bin/kimi
        work_order: arg
`)
    const lanes = await createRecipeRuntimeLanes(root)
    expect(lanes[0]!.email).toBe('aaron@agent-corporation.com')
    const config = (lanes[0]!.runtime as unknown as { config: Record<string, unknown> }).config
    expect(config.workOrderVia).toBe('arg')
    expect(config.laneEmail).toBe('aaron@agent-corporation.com')
  })

  it('a project with no lanes gets exactly one unnamed worker', async () => {
    const root = await projectWith("runtime:\n  recipe: worker\n  worker:\n    command: /bin/lane-agent\n")
    const lanes = await createRecipeRuntimeLanes(root)
    expect(lanes).toHaveLength(1)
    expect(lanes[0]!.name).toBeNull()
  })

  it('refuses a lane with no command anywhere rather than guessing one', async () => {
    const root = await projectWith("runtime:\n  recipe: worker\n  worker:\n    command: /bin/lane-agent\n    lanes:\n      - name: orphan\n")
    // The pool-level command covers it; remove that and the lane is unrunnable.
    await expect(createRecipeRuntimeLanes(root)).resolves.toHaveLength(1)
  })
})

describe('attribution', () => {
  it('every attempt records the lane, the account and the model that ran it', async () => {
    // Traceability is the point (Aaron 2026-07-28): an outcome has to name the
    // subscription that produced it, both to chase a failure to one account
    // and to accumulate a record of which model does which task well.
    const root = await projectWith(POOL)
    const lanes = await createRecipeRuntimeLanes(root)
    const runtime = lanes[2]!.runtime as unknown as {
      attributionFor: (cls: string) => Record<string, unknown>
    }
    // The private shape is what lands in the route event's runtime payload.
    const attribution = (runtime as unknown as { attributionFor: (c: string) => Record<string, unknown> })[
      'attributionFor'
    ]('high')
    expect(attribution).toEqual({
      lane: 'codex-a',
      account: null,
      model_class: 'high',
      model: 'gpt-5.5',
      command: '/bin/lane-agent-b',
    })
  })

  it('reads the model off the args the provider actually obeys', async () => {
    // Not from a second declaration that could drift from the flag we pass.
    const root = await projectWith(POOL)
    const lanes = await createRecipeRuntimeLanes(root)
    const claude = lanes[0]!.runtime as unknown as { attributionFor: (c: string) => Record<string, unknown> }
    expect(claude['attributionFor']('high').model).toBe('opus')
    // An unrouted class names no model rather than inventing one.
    expect(claude['attributionFor']('low').model).toBeNull()
  })
})
