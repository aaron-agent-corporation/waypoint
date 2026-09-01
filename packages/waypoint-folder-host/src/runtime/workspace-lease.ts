/**
 * Host-only authoritative workspace lease registry.
 *
 * Authoritative ownership/heartbeat/reclaim/integration state lives under
 * `leaseStateRoot` (never guest-mounted). Guests receive only an opaque
 * `lease_id`; forging lease-shaped files elsewhere cannot change host decisions.
 */

import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type WorkspaceLease = {
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

export type LeaseRequest = {
  readonly project_id: string
  readonly route_id: string
  readonly attempt_id: string
  readonly sandbox_instance_id: string
  readonly sandbox_generation: number
  readonly base_ref: string
  readonly owner_process_id: number
}

export type WorkspaceLeaseManagerOptions = {
  readonly sourceRepository: string
  readonly workspaceRoot: string
  readonly leaseStateRoot: string
  readonly isProcessAlive: (processId: number) => boolean | Promise<boolean>
  readonly now?: () => Date
}

function assertOpaqueId(label: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`workspace lease refused: ${label} must be a bounded opaque identifier`)
  }
}

function assertAbsoluteDirectory(label: string, value: string): void {
  if (!path.isAbsolute(value)) throw new Error(`workspace lease refused: ${label} must be absolute`)
}

function containedWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function git(cwd: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  return result.stdout.trim()
}

function leaseKey(input: Pick<LeaseRequest, 'project_id' | 'route_id' | 'attempt_id'>): string {
  return createHash('sha256')
    .update(`${input.project_id}\0${input.route_id}\0${input.attempt_id}`)
    .digest('hex')
    .slice(0, 24)
}

export class WorkspaceLeaseManager {
  readonly #sourceRepository: string
  readonly #workspaceRoot: string
  readonly #leaseStateRoot: string
  readonly #isProcessAlive: (processId: number) => boolean | Promise<boolean>
  readonly #now: () => Date

  constructor(options: WorkspaceLeaseManagerOptions) {
    assertAbsoluteDirectory('sourceRepository', options.sourceRepository)
    assertAbsoluteDirectory('workspaceRoot', options.workspaceRoot)
    assertAbsoluteDirectory('leaseStateRoot', options.leaseStateRoot)
    if (!containedWithin(options.workspaceRoot, options.leaseStateRoot) && options.leaseStateRoot !== options.workspaceRoot) {
      // Prefer lease state under workspaceRoot/.leases, but allow exact workspaceRoot children only.
      if (!options.leaseStateRoot.startsWith(path.resolve(options.workspaceRoot) + path.sep)) {
        throw new Error('workspace lease refused: leaseStateRoot must be under workspaceRoot')
      }
    }
    this.#sourceRepository = path.resolve(options.sourceRepository)
    this.#workspaceRoot = path.resolve(options.workspaceRoot)
    this.#leaseStateRoot = path.resolve(options.leaseStateRoot)
    this.#isProcessAlive = options.isProcessAlive
    this.#now = options.now ?? (() => new Date())
  }

  async acquire(input: LeaseRequest): Promise<WorkspaceLease> {
    this.#assertRequest(input)
    await mkdir(this.#leaseStateRoot, { recursive: true, mode: 0o700 })
    await mkdir(this.#workspaceRoot, { recursive: true, mode: 0o700 })

    const existing = await this.#readByAttempt(input)
    if (existing) {
      if (
        existing.project_id !== input.project_id ||
        existing.route_id !== input.route_id ||
        existing.attempt_id !== input.attempt_id ||
        existing.sandbox_instance_id !== input.sandbox_instance_id ||
        existing.sandbox_generation !== input.sandbox_generation
      ) {
        throw new Error('workspace lease refused: existing lease ownership mismatch')
      }
      if (existing.owner_process_id !== input.owner_process_id) {
        const alive = await this.#isProcessAlive(existing.owner_process_id)
        if (alive) throw new Error('workspace lease refused: active lease owned by another live process')
        throw new Error('workspace lease refused: ownership conflict — reclaim required for stale owner')
      }
      return existing
    }

    const baseCommit = await git(this.#sourceRepository, 'rev-parse', input.base_ref)
    const key = leaseKey(input)
    const leaseId = `lease_${key}_${randomBytes(4).toString('hex')}`
    const worktreeRef = `refs/waypoint/leases/${key}`
    const worktreeRoot = path.join(this.#workspaceRoot, 'attempts', key)
    if (!containedWithin(this.#workspaceRoot, worktreeRoot)) {
      throw new Error('workspace lease refused: worktree root escaped workspaceRoot')
    }

    await mkdir(path.dirname(worktreeRoot), { recursive: true, mode: 0o700 })
    // Ensure ref exists then add worktree.
    await git(this.#sourceRepository, 'update-ref', worktreeRef, baseCommit)
    if (!existsSync(worktreeRoot)) {
      await git(this.#sourceRepository, 'worktree', 'add', '--detach', worktreeRoot, baseCommit)
    }

    const observed = this.#iso()
    const lease: WorkspaceLease = {
      lease_id: leaseId,
      project_id: input.project_id,
      route_id: input.route_id,
      attempt_id: input.attempt_id,
      sandbox_instance_id: input.sandbox_instance_id,
      sandbox_generation: input.sandbox_generation,
      worktree_root: worktreeRoot,
      worktree_ref: worktreeRef,
      base_commit: baseCommit,
      owner_process_id: input.owner_process_id,
      status: 'active',
      revision: 1,
      created_at: observed,
      updated_at: observed,
      integration: { mode: 'host-controlled', status: 'pending' },
    }
    await this.#writeAtomic(lease)
    return lease
  }

  async reclaim(input: {
    readonly lease_id: string
    readonly project_id: string
    readonly route_id: string
    readonly attempt_id: string
    readonly previous_owner_process_id: number
    readonly new_owner_process_id: number
  }): Promise<WorkspaceLease> {
    assertOpaqueId('lease_id', input.lease_id)
    assertOpaqueId('project_id', input.project_id)
    assertOpaqueId('route_id', input.route_id)
    assertOpaqueId('attempt_id', input.attempt_id)

    const current = await this.#readByLeaseId(input.lease_id)
    if (!current) throw new Error('workspace lease refused: lease not found')
    if (
      current.project_id !== input.project_id ||
      current.route_id !== input.route_id ||
      current.attempt_id !== input.attempt_id
    ) {
      throw new Error('workspace lease refused: reclaim attempt ownership mismatch')
    }
    if (current.owner_process_id !== input.previous_owner_process_id) {
      throw new Error('workspace lease refused: previous owner process mismatch')
    }
    const alive = await this.#isProcessAlive(current.owner_process_id)
    if (alive) throw new Error('workspace lease refused: active lease owner still alive (conflict)')

    const updated: WorkspaceLease = {
      ...current,
      owner_process_id: input.new_owner_process_id,
      status: 'reclaimed',
      revision: current.revision + 1,
      updated_at: this.#iso(),
    }
    await this.#writeAtomic(updated)
    return updated
  }

  #assertRequest(input: LeaseRequest): void {
    assertOpaqueId('project_id', input.project_id)
    assertOpaqueId('route_id', input.route_id)
    assertOpaqueId('attempt_id', input.attempt_id)
    assertOpaqueId('sandbox_instance_id', input.sandbox_instance_id)
    if (!Number.isInteger(input.sandbox_generation) || input.sandbox_generation < 1) {
      throw new Error('workspace lease refused: sandbox_generation must be a positive integer')
    }
    if (!Number.isInteger(input.owner_process_id) || input.owner_process_id < 1) {
      throw new Error('workspace lease refused: owner_process_id must be a positive integer')
    }
    if (!input.base_ref || input.base_ref.includes('\0')) {
      throw new Error('workspace lease refused: base_ref invalid')
    }
  }

  #recordPath(leaseId: string): string {
    return path.join(this.#leaseStateRoot, `${leaseId}.json`)
  }

  #indexPath(input: Pick<LeaseRequest, 'project_id' | 'route_id' | 'attempt_id'>): string {
    return path.join(this.#leaseStateRoot, `by-attempt-${leaseKey(input)}.json`)
  }

  async #readByAttempt(input: Pick<LeaseRequest, 'project_id' | 'route_id' | 'attempt_id'>): Promise<WorkspaceLease | null> {
    const indexPath = this.#indexPath(input)
    if (!existsSync(indexPath)) return null
    const leaseId = JSON.parse(await readFile(indexPath, 'utf8')).lease_id as string
    return this.#readByLeaseId(leaseId)
  }

  async #readByLeaseId(leaseId: string): Promise<WorkspaceLease | null> {
    const filePath = this.#recordPath(leaseId)
    if (!existsSync(filePath)) return null
    return JSON.parse(await readFile(filePath, 'utf8')) as WorkspaceLease
  }

  async #writeAtomic(lease: WorkspaceLease): Promise<void> {
    const filePath = this.#recordPath(lease.lease_id)
    const indexPath = this.#indexPath(lease)
    const tmp = `${filePath}.${process.pid}.tmp`
    const indexTmp = `${indexPath}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(lease, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, filePath)
    await writeFile(indexTmp, `${JSON.stringify({ lease_id: lease.lease_id }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(indexTmp, indexPath)
  }

  #iso(): string {
    return this.#now().toISOString()
  }
}
