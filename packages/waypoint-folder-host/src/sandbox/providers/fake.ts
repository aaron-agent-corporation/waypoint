/**
 * Deterministic fake ProjectSandboxProvider for unit/CI tests.
 *
 * Never contacts a cloud provider and never requires credentials. Production
 * admission must not treat fake packets as provider qualification.
 */

import {
  assertProjectSandboxBinding,
  stableProjectSandboxName,
  type ProjectSandboxBinding,
  type ProjectSandboxCreateInput,
  type ProjectSandboxEnterInput,
  type ProjectSandboxEnterResult,
  type ProjectSandboxHealth,
  type ProjectSandboxProvider,
  type ProjectSandboxState,
  type ProjectSandboxVerification,
} from '../provider.ts'
import { readSandboxState, writeSandboxState } from '../state-store.ts'

export type FakeEnterOperation = ProjectSandboxEnterInput & {
  readonly write?: readonly [string, string]
  readonly read?: string
}

export const FAKE_PROVIDER_KIND = 'fake' as const

export const FAKE_VERIFIED_PROBES = [
  { id: 'portfolio-store-read', result: 'not_mounted' },
  { id: 'manager-brief-read', result: 'not_mounted' },
  { id: 'other-project-read', result: 'not_mounted' },
  { id: 'host-home-secret-read', result: 'denied', secret_plaintext_available: false },
  { id: 'denied-host-egress', result: 'denied' },
  { id: 'raw-ip-egress', result: 'denied' },
  { id: 'allowlisted-model-egress', result: 'allowed', secret_plaintext_available: false },
  { id: 'parallel-write-collision', result: 'denied' },
  { id: 'managed-host-fallback', result: 'denied' },
  { id: 'forged-managed-start', result: 'denied' },
] as const

/**
 * In-memory provider that models observable lifecycle/state evidence without
 * importing or executing Microsandbox or any cloud SDK.
 */
export class FakeProjectSandboxProvider implements ProjectSandboxProvider {
  readonly provider = FAKE_PROVIDER_KIND
  readonly #bindings = new Map<string, ProjectSandboxState>()
  readonly #files = new Map<string, Map<string, string>>()
  readonly #stopped = new Set<string>()
  #nextInstance = 1
  readonly #stableName: (projectId: string) => string
  readonly #assertBinding: (expected: ProjectSandboxBinding, actual: ProjectSandboxBinding) => void

  constructor(
    stableName: (projectId: string) => string = stableProjectSandboxName,
    assertBinding: (
      expected: ProjectSandboxBinding,
      actual: ProjectSandboxBinding,
    ) => void = assertProjectSandboxBinding,
  ) {
    this.#stableName = stableName
    this.#assertBinding = assertBinding
  }

  async create(input: ProjectSandboxCreateInput): Promise<ProjectSandboxState> {
    const existing = this.#bindings.get(input.project_id)
    if (existing) {
      this.#assertBinding(existing, { ...existing, ...input })
      return existing
    }
    const ordinal = String(this.#nextInstance++).padStart(4, '0')
    const now = '2026-08-18T00:00:00.000Z'
    const binding: ProjectSandboxState = {
      ...input,
      provider: this.provider,
      sandbox_instance_id: `fake-instance-${ordinal}`,
      sandbox_name: this.#stableName(input.project_id),
      generation: 1,
      lifecycle: 'running',
      created_at: now,
      updated_at: now,
    }
    this.#bindings.set(input.project_id, binding)
    this.#files.set(binding.sandbox_instance_id, new Map())
    writeSandboxState(binding)
    return binding
  }

  async inspectByProjectId(projectId: string): Promise<ProjectSandboxState | null> {
    const local = this.#bindings.get(projectId)
    if (local) return local
    const durable = readSandboxState(projectId)
    if (!durable || durable.provider !== this.provider) return null
    this.#bindings.set(projectId, durable)
    if (!this.#files.has(durable.sandbox_instance_id)) {
      this.#files.set(durable.sandbox_instance_id, new Map())
    }
    return durable
  }

  async inspect(binding: ProjectSandboxBinding): Promise<ProjectSandboxState | null> {
    const current = this.#bindings.get(binding.project_id) ?? this.#rehydrate(binding) ?? (await this.inspectByProjectId(binding.project_id))
    if (!current) return null
    this.#assertBinding(current, binding)
    return current
  }

  async verify(binding: ProjectSandboxBinding): Promise<ProjectSandboxVerification> {
    const current = this.#bindings.get(binding.project_id) ?? this.#rehydrate(binding)
    if (!current) throw new Error('sandbox not found')
    this.#assertBinding(current, binding)
    return {
      ...current,
      enterable: true,
      virtualization: 'microvm',
      healthy: true,
      policy_verified: true,
      mount_policy_verified: true,
      observed_at: '2026-08-18T00:00:00.000Z',
      probes: FAKE_VERIFIED_PROBES,
    }
  }

  async health(binding: ProjectSandboxBinding): Promise<ProjectSandboxHealth> {
    await this.verify(binding)
    const stopped = this.#stopped.has(binding.sandbox_instance_id)
    return {
      ...binding,
      status: stopped ? 'stopped' : 'healthy',
      healthy: !stopped,
      virtualization: 'microvm',
      observed_at: '2026-08-18T00:00:00.000Z',
    }
  }

  async enter(binding: ProjectSandboxBinding, operation: FakeEnterOperation): Promise<ProjectSandboxEnterResult> {
    await this.verify(binding)
    this.#stopped.delete(binding.sandbox_instance_id)
    let files = this.#files.get(binding.sandbox_instance_id)
    if (!files) {
      files = new Map()
      this.#files.set(binding.sandbox_instance_id, files)
    }
    if (operation.write) files.set(operation.write[0], operation.write[1])
    return {
      exit_code: 0,
      stdout: operation.read === undefined ? '' : (files.get(operation.read) ?? ''),
      stderr: '',
      observed_at: '2026-08-18T00:00:00.000Z',
    }
  }

  async stop(binding: ProjectSandboxBinding): Promise<void> {
    await this.verify(binding)
    this.#stopped.add(binding.sandbox_instance_id)
  }

  /** Rehydrate from a previously emitted binding so CLI create→verify works across provider instances. */
  #rehydrate(binding: ProjectSandboxBinding): ProjectSandboxState | null {
    if (binding.provider !== this.provider) return null
    if (!binding.sandbox_instance_id.startsWith('fake-instance-')) return null
    const now = '2026-08-18T00:00:00.000Z'
    const state: ProjectSandboxState = {
      ...binding,
      lifecycle: this.#stopped.has(binding.sandbox_instance_id) ? 'stopped' : 'running',
      created_at: now,
      updated_at: now,
    }
    this.#bindings.set(binding.project_id, state)
    if (!this.#files.has(binding.sandbox_instance_id)) {
      this.#files.set(binding.sandbox_instance_id, new Map())
    }
    return state
  }
}
