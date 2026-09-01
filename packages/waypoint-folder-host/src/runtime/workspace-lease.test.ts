import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

type WorkspaceLease = {
  readonly lease_id: string
  readonly project_id: string
  readonly route_id: string
  readonly attempt_id: string
  readonly sandbox_instance_id: string
  readonly sandbox_generation: number
  readonly worktree_root: string
  readonly worktree_ref: string
  readonly base_commit: string
  readonly owner_process_id: number
  readonly status: 'active' | 'released' | 'reclaimed'
  readonly revision: number
  readonly created_at: string
  readonly updated_at: string
  readonly integration: { readonly mode: 'host-controlled'; readonly status: 'pending' | 'integrated' }
}

type LeaseRequest = {
  readonly project_id: string
  readonly route_id: string
  readonly attempt_id: string
  readonly sandbox_instance_id: string
  readonly sandbox_generation: number
  readonly base_ref: string
  readonly owner_process_id: number
}

type WorkspaceLeaseManager = {
  acquire(input: LeaseRequest): Promise<WorkspaceLease>
  reclaim(input: {
    readonly lease_id: string
    readonly project_id: string
    readonly route_id: string
    readonly attempt_id: string
    readonly previous_owner_process_id: number
    readonly new_owner_process_id: number
  }): Promise<WorkspaceLease>
}

type WorkspaceLeaseManagerConstructor = new (input: {
  readonly sourceRepository: string
  readonly workspaceRoot: string
  readonly leaseStateRoot: string
  readonly isProcessAlive: (processId: number) => boolean | Promise<boolean>
  readonly now?: () => Date
}) => WorkspaceLeaseManager

async function plannedLeaseManager(marker: string): Promise<WorkspaceLeaseManagerConstructor> {
  const moduleUrl = new URL('./workspace-lease.ts', import.meta.url)
  if (!existsSync(fileURLToPath(moduleUrl))) expect.fail(`PHASE1_MISSING[${marker}]`)
  const modulePath = moduleUrl.href
  const planned = (await import(/* @vite-ignore */ modulePath)) as {
    WorkspaceLeaseManager?: WorkspaceLeaseManagerConstructor
  }
  if (typeof planned.WorkspaceLeaseManager !== 'function') expect.fail(`PHASE1_MISSING[${marker}]`)
  return planned.WorkspaceLeaseManager
}

async function git(cwd: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  })
  return result.stdout.trim()
}

async function tempRepository(prefix: string): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  await git(root, 'init', '--quiet')
  await git(root, 'config', 'user.email', 'workspace-contract@example.invalid')
  await git(root, 'config', 'user.name', 'Workspace Contract')
  await writeFile(path.join(root, 'tracked.txt'), 'baseline\n', 'utf8')
  await git(root, 'add', '--', 'tracked.txt')
  await git(root, 'commit', '--quiet', '-m', 'baseline')
  return { root, head: await git(root, 'rev-parse', 'HEAD') }
}

function expectContained(parent: string, candidate: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  expect(relative).not.toBe('')
  expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false)
}

describe('WorkspaceLease Wave 0 contracts', () => {
  it('PHASE1_RED[waypoint-provider] parallel attempts receive stable, collision-free real Git worktrees', async () => {
    const Manager = await plannedLeaseManager('waypoint-provider.workspace-lease')
    const repository = await tempRepository('workspace-lease-contract-')
    const workspaceRoot = path.join(path.dirname(repository.root), `${path.basename(repository.root)}-managed-workspace`)
    const leaseStateRoot = path.join(workspaceRoot, '.leases')
    await mkdir(leaseStateRoot, { recursive: true })
    const manager = new Manager({
      sourceRepository: repository.root,
      workspaceRoot,
      leaseStateRoot,
      isProcessAlive: () => true,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    })
    const common = {
      project_id: 'prj_opaque_a',
      route_id: 'route-managed-a',
      sandbox_instance_id: 'sandbox-instance-a',
      sandbox_generation: 7,
      base_ref: 'HEAD',
    }
    const first = await manager.acquire({ ...common, attempt_id: 'attempt-a', owner_process_id: 101 })
    const firstAgain = await manager.acquire({ ...common, attempt_id: 'attempt-a', owner_process_id: 101 })
    const second = await manager.acquire({ ...common, attempt_id: 'attempt-b', owner_process_id: 102 })

    expect(firstAgain).toEqual(first)
    expect(first.lease_id).not.toBe(second.lease_id)
    expect(first.worktree_root).not.toBe(second.worktree_root)
    expect(first.worktree_ref).not.toBe(second.worktree_ref)
    expect(first.base_commit).toBe(repository.head)
    expect(second.base_commit).toBe(repository.head)
    expect(first.integration).toEqual({ mode: 'host-controlled', status: 'pending' })
    expect(second.integration).toEqual({ mode: 'host-controlled', status: 'pending' })
    expectContained(workspaceRoot, first.worktree_root)
    expectContained(workspaceRoot, second.worktree_root)

    await writeFile(path.join(first.worktree_root, 'attempt.txt'), 'first\n', 'utf8')
    await writeFile(path.join(second.worktree_root, 'attempt.txt'), 'second\n', 'utf8')
    expect(await readFile(path.join(first.worktree_root, 'attempt.txt'), 'utf8')).toBe('first\n')
    expect(await readFile(path.join(second.worktree_root, 'attempt.txt'), 'utf8')).toBe('second\n')
    expect(existsSync(path.join(repository.root, 'attempt.txt'))).toBe(false)
    expect(await git(repository.root, 'status', '--porcelain')).toBe('')
  })

  it('PHASE1_RED[waypoint-provider] restart reclaim refuses live or mismatched ownership and recovers one stale lease', async () => {
    const Manager = await plannedLeaseManager('waypoint-provider.crash-reclaim')
    const repository = await tempRepository('workspace-reclaim-contract-')
    const workspaceRoot = path.join(path.dirname(repository.root), `${path.basename(repository.root)}-managed-workspace`)
    const leaseStateRoot = path.join(workspaceRoot, '.leases')
    await mkdir(leaseStateRoot, { recursive: true })
    const request: LeaseRequest = {
      project_id: 'prj_opaque_a',
      route_id: 'route-managed-a',
      attempt_id: 'attempt-a',
      sandbox_instance_id: 'sandbox-instance-a',
      sandbox_generation: 7,
      base_ref: 'HEAD',
      owner_process_id: 401,
    }
    const originalManager = new Manager({
      sourceRepository: repository.root,
      workspaceRoot,
      leaseStateRoot,
      isProcessAlive: (processId) => processId === 401,
    })
    const original = await originalManager.acquire(request)

    const liveOwnerManager = new Manager({
      sourceRepository: repository.root,
      workspaceRoot,
      leaseStateRoot,
      isProcessAlive: (processId) => processId === 401,
    })
    await expect(
      liveOwnerManager.reclaim({
        lease_id: original.lease_id,
        project_id: request.project_id,
        route_id: request.route_id,
        attempt_id: request.attempt_id,
        previous_owner_process_id: 401,
        new_owner_process_id: 402,
      }),
    ).rejects.toThrow(/owner.*alive|active lease|conflict/i)

    const deadOwnerManager = new Manager({
      sourceRepository: repository.root,
      workspaceRoot,
      leaseStateRoot,
      isProcessAlive: () => false,
      now: () => new Date('2026-08-18T12:05:00.000Z'),
    })
    await expect(
      deadOwnerManager.reclaim({
        lease_id: original.lease_id,
        project_id: request.project_id,
        route_id: request.route_id,
        attempt_id: 'attempt-substituted',
        previous_owner_process_id: 401,
        new_owner_process_id: 402,
      }),
    ).rejects.toThrow(/attempt|ownership|mismatch/i)

    const reclaimed = await deadOwnerManager.reclaim({
      lease_id: original.lease_id,
      project_id: request.project_id,
      route_id: request.route_id,
      attempt_id: request.attempt_id,
      previous_owner_process_id: 401,
      new_owner_process_id: 402,
    })
    expect(reclaimed.lease_id).toBe(original.lease_id)
    expect(reclaimed.worktree_root).toBe(original.worktree_root)
    expect(reclaimed.worktree_ref).toBe(original.worktree_ref)
    expect(reclaimed.owner_process_id).toBe(402)
    expect(reclaimed.status).toBe('reclaimed')
    expect(reclaimed.revision).toBe(original.revision + 1)
  })

  it('guest-visible lease-shaped files cannot change host authority', async () => {
    const Manager = await plannedLeaseManager('waypoint-provider.lease-tamper')
    const repository = await tempRepository('workspace-lease-tamper-')
    const workspaceRoot = path.join(path.dirname(repository.root), `${path.basename(repository.root)}-managed-workspace`)
    const leaseStateRoot = path.join(workspaceRoot, '.leases')
    await mkdir(leaseStateRoot, { recursive: true })
    const manager = new Manager({
      sourceRepository: repository.root,
      workspaceRoot,
      leaseStateRoot,
      isProcessAlive: () => false,
    })
    const lease = await manager.acquire({
      project_id: 'prj_opaque_a',
      route_id: 'route-managed-a',
      attempt_id: 'attempt-a',
      sandbox_instance_id: 'sandbox-instance-a',
      sandbox_generation: 7,
      base_ref: 'HEAD',
      owner_process_id: 501,
    })

    const guestVisible = path.join(lease.worktree_root, 'lease_authority.json')
    await writeFile(guestVisible, JSON.stringify({ lease_id: 'forged', owner_process_id: 999, status: 'active', revision: 99 }), 'utf8')
    await writeFile(path.join(lease.worktree_root, `${lease.lease_id}.json`), JSON.stringify({ status: 'released' }), 'utf8')

    const reclaimed = await manager.reclaim({
      lease_id: lease.lease_id,
      project_id: lease.project_id,
      route_id: lease.route_id,
      attempt_id: lease.attempt_id,
      previous_owner_process_id: 501,
      new_owner_process_id: 502,
    })
    expect(reclaimed.owner_process_id).toBe(502)
    expect(reclaimed.revision).toBe(lease.revision + 1)
    await expect(
      manager.reclaim({
        lease_id: 'lease_forged_guest',
        project_id: lease.project_id,
        route_id: lease.route_id,
        attempt_id: lease.attempt_id,
        previous_owner_process_id: 501,
        new_owner_process_id: 503,
      }),
    ).rejects.toThrow(/not found|refus/i)
  })
})
