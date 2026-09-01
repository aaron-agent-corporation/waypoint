import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildLocalRecipePayload } from './payload.ts'
import { LocalRecipeRuntime } from './local-runtime.ts'

describe('local recipe runtime', () => {
  it('builds a stable JSON payload for local Recipe execution', () => {
    const payload = buildLocalRecipePayload({
      projectRoot: '/tmp/project',
      routeId: 'route-001',
      taskId: 'task-003',
      recipeSlug: 'runner-doc-writer',
      prompt: 'Write docs',
    })

    expect(payload).toEqual({
      schema_version: 1,
      recipe_slug: 'runner-doc-writer',
      prompt: 'Write docs',
      task_id: 'task-003',
      project_root: '/tmp/project',
      route_id: 'route-001',
    })
  })

  it('invokes a configured local command with the payload on stdin', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'runner-local-runtime-'))
    const payloadPath = join(cwd, 'payload.json')
    const scriptPath = join(cwd, 'capture.mjs')
    await writeFile(
      scriptPath,
      `import { writeFile } from 'node:fs/promises'\nlet input = ''\nfor await (const chunk of process.stdin) input += chunk\nawait writeFile(process.argv[2], input)\nconsole.log(JSON.stringify({ handle: 'local-ok' }))\n`,
      'utf8',
    )
    await chmod(scriptPath, 0o755)

    const runtime = new LocalRecipeRuntime({ command: process.execPath, args: [scriptPath, payloadPath] })
    const output = await runtime.runRecipe({
      projectRoot: cwd,
      routeId: 'route-001',
      taskId: 'task-003',
      recipe: 'runner-doc-writer',
      prompt: 'Write docs',
    })

    expect(output.status).toBe('finished')
    expect(output.runtime).toBe('local')
    expect(output.exit_code).toBe(0)
    expect(output.stdout).toContain('local-ok')
    await expect(readFile(payloadPath, 'utf8').then((raw) => JSON.parse(raw))).resolves.toMatchObject({
      schema_version: 1,
      recipe_slug: 'runner-doc-writer',
      prompt: 'Write docs',
      task_id: 'task-003',
      project_root: cwd,
      route_id: 'route-001',
    })
  })

  it('captures non-zero exits as failed runtime output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'runner-local-runtime-fail-'))
    const scriptPath = join(cwd, 'fail.mjs')
    await writeFile(scriptPath, `console.error('boom')\nprocess.exit(7)\n`, 'utf8')

    const runtime = new LocalRecipeRuntime({ command: process.execPath, args: [scriptPath] })
    const output = await runtime.runRecipe({
      projectRoot: cwd,
      routeId: 'route-001',
      taskId: 'task-003',
      recipe: 'runner-doc-writer',
      prompt: 'Write docs',
    })

    expect(output).toMatchObject({
      status: 'failed',
      runtime: 'local',
      exit_code: 7,
      recipe: 'runner-doc-writer',
      task_id: 'task-003',
      route_id: 'route-001',
    })
    expect(output.stderr).toContain('boom')
  })
})
