import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { accountRefusal } from '../pgdurable/lane-health.ts'
import { runWorkerCommand } from './worker-spawn.ts'

/**
 * The gemini lane asked "Do you want to continue? [Y/n]:" of a stdin nobody
 * was holding and kept one intake dispatch for its whole 180-minute budget
 * (2026-08-20). A worker blocked on a question makes no further progress.
 */
describe('a worker that asks a question nobody can answer', () => {
  it('is killed on the question instead of holding the budget', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'worker-prompt-'))
    const asksThenSleeps =
      'echo "Opening authentication page in your browser. Do you want to continue? [Y/n]: "; sleep 60'

    const started = Date.now()
    const result = await runWorkerCommand(['/bin/sh', '-c', asksThenSleeps], '', cwd, 60_000)

    expect(result.blockedPrompt).toMatch(/opening authentication page/i)
    expect(result.timedOut).toBe(false)
    expect(Date.now() - started).toBeLessThan(20_000)
    // And the lane — not the task — is what took the blame, so the work is
    // re-queued for another provider rather than recorded as a failed attempt.
    expect(accountRefusal({ stdout: result.stdout, stderr: result.stderr })).toMatch(/authentication page/i)
  })

  it('leaves an ordinary worker alone', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'worker-plain-'))

    const result = await runWorkerCommand(['/bin/sh', '-c', 'echo working; echo done'], '', cwd, 20_000)

    expect(result.blockedPrompt).toBeUndefined()
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('done')
  })
})
