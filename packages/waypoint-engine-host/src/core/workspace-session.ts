import { basename } from 'node:path'

import {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  initWaypointProject,
  initializeWaypointBeadsWorkspace,
  installQuestCatalog,
  loadBundledWaypointCatalog,
  readWaypointStatus,
  WaypointBeadsCliIssueClient,
} from '@waypoint/folder-host'
import type { WaypointProjectStatus } from '@waypoint/folder-host'

import { EngineError } from '../envelope.ts'
import type { EngineBackend } from '../types.ts'

export interface WorkspaceState {
  readonly root: string
  readonly backend: EngineBackend
  readonly initialized: true
}

export interface OpenWorkspaceInput {
  readonly root: string
  readonly backend?: EngineBackend
  readonly initBeads?: boolean
  readonly force?: boolean
}

/**
 * Beads client options threaded into folder-host calls. One session-owned
 * `WaypointBeadsCliIssueClient` satisfies every seam (it is the default the
 * folder-host constructs per call); we reuse one instance under all four names.
 */
export interface BeadsClientOptions {
  readonly beadsClient?: WaypointBeadsCliIssueClient
  readonly beadsReader?: WaypointBeadsCliIssueClient
  readonly beadsMutator?: WaypointBeadsCliIssueClient
  readonly beadsCommentReader?: WaypointBeadsCliIssueClient
}

export class WorkspaceSession {
  private state: WorkspaceState | null = null
  private inFlight = 0
  private tail: Promise<unknown> = Promise.resolve()
  private beadsClient: WaypointBeadsCliIssueClient | null = null

  current(): WorkspaceState | null {
    return this.state
  }

  requireActive(): WorkspaceState {
    if (!this.state) {
      throw new EngineError('No workspace open; call workspace.open first', { code: 'NO_WORKSPACE' })
    }
    return this.state
  }

  async open(input: OpenWorkspaceInput): Promise<WorkspaceState> {
    if (typeof input.root !== 'string' || input.root.trim() === '') {
      throw new EngineError('workspace.open requires a non-empty root path', { code: 'VALIDATION', field: 'root' })
    }
    if (this.state && this.inFlight > 0 && !input.force) {
      throw new EngineError('Cannot switch workspace while runs are active; pass force to override', {
        code: 'CONFLICT',
      })
    }

    const requestedBackend: EngineBackend = input.backend ?? 'folder'
    const status = await readWaypointStatus(input.root)

    let backend: EngineBackend
    if (status.initialized) {
      const existing = (status.backend ?? 'folder') as EngineBackend
      if (input.backend && input.backend !== existing) {
        throw new EngineError(
          `Workspace at ${input.root} is backend '${existing}', cannot open as '${input.backend}'`,
          { code: 'CONFLICT', field: 'backend' },
        )
      }
      backend = existing
    } else {
      backend = requestedBackend
      await this.initializeWorkspace(input.root, backend, input.initBeads ?? backend === 'beads')
    }

    this.state = { root: input.root, backend, initialized: true }
    this.beadsClient = backend === 'beads' ? new WaypointBeadsCliIssueClient({ cwd: input.root }) : null
    return this.state
  }

  async status(): Promise<WaypointProjectStatus> {
    return readWaypointStatus(this.requireActive().root)
  }

  /** Counter guarding workspace switches while commands are in flight. */
  async runGuard<T>(fn: () => Promise<T>): Promise<T> {
    this.inFlight += 1
    try {
      return await fn()
    } finally {
      this.inFlight -= 1
    }
  }

  /**
   * Manual in-flight lease for async work (e.g. a background agent session) that
   * outlives a single dispatch. Holds the workspace open until released exactly
   * once. Mirrors `runGuard`'s counter without wrapping a promise.
   */
  acquireLease(): () => void {
    this.inFlight += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.inFlight -= 1
    }
  }

  /** Per-workspace serial mutex: serializes bd-backed mutations (Task-0 Spike B remedy). */
  async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Spreadable beads options for folder-host calls; `{}` for folder backend. */
  beadsOptions(): BeadsClientOptions {
    if (!this.beadsClient) return {}
    return {
      beadsClient: this.beadsClient,
      beadsReader: this.beadsClient,
      beadsMutator: this.beadsClient,
      beadsCommentReader: this.beadsClient,
    }
  }

  private async initializeWorkspace(root: string, backend: EngineBackend, initBeads: boolean): Promise<void> {
    if (backend === 'beads' && initBeads) {
      const readiness = await initializeWaypointBeadsWorkspace({ cwd: root, prefix: basename(root) })
      if (!readiness.ok) {
        throw new EngineError(formatWaypointBeadsWorkspaceReadinessFailure(readiness), { code: 'BACKEND_ERROR' })
      }
    }
    const catalog = await loadBundledWaypointCatalog()
    await initWaypointProject(root, { quest: 'waypoint', backend })
    await installQuestCatalog(root, catalog, { quest: 'waypoint' })
    if (backend === 'beads') {
      const readiness = await checkWaypointBeadsWorkspace({ cwd: root })
      if (!readiness.ok) {
        throw new EngineError(formatWaypointBeadsWorkspaceReadinessFailure(readiness), { code: 'BACKEND_ERROR' })
      }
    }
  }
}
