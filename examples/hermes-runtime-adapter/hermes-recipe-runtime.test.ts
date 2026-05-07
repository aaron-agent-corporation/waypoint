import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../..')
const runtimePath = resolve(repoRoot, 'examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs')

async function runRuntime(payload: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [runtimePath], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr })
    })
    child.stdin.end(`${JSON.stringify(payload)}\n`, 'utf8')
  })
}

describe('Hermes Recipe runtime reference adapter', () => {
  it('accepts the F10 local runtime payload on stdin and emits structured Hermes stdout', async () => {
    const result = await runRuntime({
      schema_version: 1,
      recipe_slug: 'waypoint-doc-writer',
      prompt: 'Draft the operator docs.',
      task_id: 'task-003',
      route_id: 'route-001',
      project_root: '/tmp/waypoint-project',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const output = JSON.parse(result.stdout)
    expect(output).toMatchObject({
      ok: true,
      adapter: 'hermes-recipe-runtime-reference',
      recipe_slug: 'waypoint-doc-writer',
      task_id: 'task-003',
      route_id: 'route-001',
      project_root: '/tmp/waypoint-project',
      routed_to: 'doc-writer-capable Hermes/Gary execution',
    })
    expect(output.summary).toContain('waypoint-doc-writer')
    expect(output.messages[0].content).toContain('task-003')
  })

  it('routes known GSD planner and verifier slugs to named Hermes capabilities', async () => {
    const planner = await runRuntime({
      schema_version: 1,
      recipe_slug: 'waypoint-planner',
      prompt: 'Plan the work.',
      task_id: 'task-004',
      route_id: 'route-001',
      project_root: '/tmp/waypoint-project',
    })
    const verifier = await runRuntime({
      schema_version: 1,
      recipe_slug: 'waypoint-verifier',
      prompt: 'Verify the work.',
      task_id: 'task-005',
      route_id: 'route-001',
      project_root: '/tmp/waypoint-project',
    })

    expect(JSON.parse(planner.stdout).routed_to).toBe('planner-capable Hermes/Gary execution')
    expect(JSON.parse(verifier.stdout).routed_to).toBe('verifier-capable Hermes/Gary execution')
  })

  it('keeps unknown recipe slugs explicit instead of pretending a specialist exists', async () => {
    const result = await runRuntime({
      schema_version: 1,
      recipe_slug: 'custom-recipe',
      prompt: 'Do custom work.',
      task_id: 'task-006',
      route_id: 'route-002',
      project_root: '/tmp/waypoint-project',
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.routed_to).toBe('Gary/orchestrator fallback')
    expect(output.summary).toContain('unknown recipe_slug custom-recipe')
  })

  it('fails non-zero for invalid payloads so the local runtime persists task and route failure', async () => {
    const result = await runRuntime({
      schema_version: 1,
      recipe_slug: 'waypoint-doc-writer',
      prompt: 'Missing ids',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Invalid Hermes Recipe runtime payload')
    expect(result.stderr).toContain('task_id is required')
  })
})
