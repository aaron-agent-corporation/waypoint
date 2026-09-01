import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { claimHostPath, claimRelPath, claimSandboxPath, fileClaimReportContract, readSandboxClaim, toSandboxPath } from './claim.ts'

async function projectWithClaim(body: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'sandbox-claim-'))
  const file = claimHostPath(root, 'route-001', 'task-1')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body, 'utf8')
  return root
}

describe('the file-based claim (rsc-3yf)', () => {
  it('reads a well-formed claim as the agent’s report row', async () => {
    const root = await projectWithClaim(JSON.stringify({ task_id: 'task-1', status: 'finished', summary: 'built the chronology' }))
    expect(await readSandboxClaim(root, 'route-001', 'task-1')).toEqual({
      task_id: 'task-1',
      status: 'finished',
      summary: 'built the chronology',
    })
  })

  it('returns null when the agent never wrote a claim — the host reads that as no report at all', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sandbox-claim-'))
    expect(await readSandboxClaim(root, 'route-001', 'task-1')).toBeNull()
  })

  it('treats a garbled claim as no report rather than crashing the runtime', async () => {
    const root = await projectWithClaim('{ this is not json')
    expect(await readSandboxClaim(root, 'route-001', 'task-1')).toBeNull()
  })

  it('treats a non-object claim as no report (an array is not a report row)', async () => {
    const root = await projectWithClaim('["finished"]')
    expect(await readSandboxClaim(root, 'route-001', 'task-1')).toBeNull()
  })

  it('scopes the claim per attempt so one task cannot read another’s', () => {
    expect(claimRelPath('route-001', 'task-1')).toBe('.waypoint/claims/route-001/task-1.json')
    expect(claimRelPath('route-001', 'task-2')).not.toBe(claimRelPath('route-001', 'task-1'))
  })

  it('points the agent at the path it can actually see, inside the mount', () => {
    expect(claimSandboxPath('/work', 'route-001', 'task-1')).toBe('/work/.waypoint/claims/route-001/task-1.json')
  })

  it('tells the agent the file is the report and the CLI is not to be used', () => {
    const contract = fileClaimReportContract('task-1', '/work/.waypoint/claims/route-001/task-1.json').join('\n')
    expect(contract).toMatch(/Do NOT use `waypoint tasks report`/)
    expect(contract).toContain('/work/.waypoint/claims/route-001/task-1.json')
    // The doctrine survives the change of medium.
    expect(contract).toMatch(/your claim, not the verdict/)
    expect(contract).toMatch(/exactly once/)
  })
})

describe('toSandboxPath', () => {
  it('translates a host path into the path the agent sees', () => {
    expect(toSandboxPath('/cases/dl', '/cases/dl/.waypoint/scratch/r/t', '/work')).toBe('/work/.waypoint/scratch/r/t')
  })

  it('maps the project root itself to the mount point', () => {
    expect(toSandboxPath('/cases/dl', '/cases/dl', '/work')).toBe('/work')
  })

  it('refuses a path outside the project — it has no counterpart inside', () => {
    expect(() => toSandboxPath('/cases/dl', '/etc/passwd', '/work')).toThrow(/outside the project root/)
  })
})
