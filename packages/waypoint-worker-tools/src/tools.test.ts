import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildWorkerTools } from './tools.ts'

describe('worker report tool', () => {
  let dir: string
  const env: NodeJS.ProcessEnv = {}

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worker-tools-'))
    env.WAYPOINT_CLAIM_PATH = process.env.WAYPOINT_CLAIM_PATH
    env.WAYPOINT_TASK_ID = process.env.WAYPOINT_TASK_ID
    process.env.WAYPOINT_CLAIM_PATH = join(dir, 'claims', 'route-1', 'task-1.json')
    process.env.WAYPOINT_TASK_ID = 'task-1'
  })

  afterEach(async () => {
    if (env.WAYPOINT_CLAIM_PATH === undefined) delete process.env.WAYPOINT_CLAIM_PATH
    else process.env.WAYPOINT_CLAIM_PATH = env.WAYPOINT_CLAIM_PATH
    if (env.WAYPOINT_TASK_ID === undefined) delete process.env.WAYPOINT_TASK_ID
    else process.env.WAYPOINT_TASK_ID = env.WAYPOINT_TASK_ID
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses to file when no claim path was injected', async () => {
    delete process.env.WAYPOINT_CLAIM_PATH
    const [report] = buildWorkerTools()
    const result = await report!.execute({ status: 'finished', summary: 'done' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/WAYPOINT_CLAIM_PATH unset/)
  })

  it('rejects a status outside the contract', async () => {
    const [report] = buildWorkerTools()
    const result = await report!.execute({ status: 'done', summary: 'nope' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/must be "finished" or "failed"/)
  })

  it('writes the claim file with review verdicts under the review. prefix', async () => {
    const [report] = buildWorkerTools()
    const result = await report!.execute({
      status: 'finished',
      summary: 'assembled the thing',
      brief: 'one input conflicted; chose the newer',
      review: { 'outputs parse': 'pass: parsed all three', 'no placeholders': 'fail: one TODO left' },
    })
    expect(result.isError).toBeUndefined()
    const claim = JSON.parse(await readFile(process.env.WAYPOINT_CLAIM_PATH!, 'utf8')) as Record<string, unknown>
    expect(claim.task_id).toBe('task-1')
    expect(claim.status).toBe('finished')
    expect(claim.summary).toBe('assembled the thing')
    expect(claim.brief).toBe('one input conflicted; chose the newer')
    expect(claim.evidence).toEqual({
      'review.outputs parse': 'pass: parsed all three',
      'review.no placeholders': 'fail: one TODO left',
    })
  })

  it('omits an empty brief rather than filing whitespace', async () => {
    const [report] = buildWorkerTools()
    await report!.execute({ status: 'failed', summary: 'blocked', brief: '   ' })
    const claim = JSON.parse(await readFile(process.env.WAYPOINT_CLAIM_PATH!, 'utf8')) as Record<string, unknown>
    expect(claim.status).toBe('failed')
    expect('brief' in claim).toBe(false)
  })
})
