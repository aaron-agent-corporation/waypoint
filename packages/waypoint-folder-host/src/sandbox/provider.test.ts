import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { sandboxConfigProblem } from './gate.ts'
import { assembleSandboxMounts } from './mounts.ts'
import { PROJECT_SANDBOX_MANAGER_ACTIONS } from './provider.ts'
import type {
  ProjectSandboxBinding,
  ProjectSandboxCreateInput,
  ProjectSandboxDestroyAuthorization,
  ProjectSandboxHealth,
  ProjectSandboxState,
  ProjectSandboxVerification,
} from './provider.ts'
import { FakeProjectSandboxProvider, FAKE_VERIFIED_PROBES } from './providers/fake.ts'
import { buildSandboxArgv } from './runtime.ts'
import { buildWorkerEnv } from '../runtime/worker-env.ts'

type ProviderContractModule = {
  stableProjectSandboxName(projectId: string): string
  assertValidProjectSandboxBinding(binding: ProjectSandboxBinding): void
  assertProjectSandboxBinding(expected: ProjectSandboxBinding, actual: ProjectSandboxBinding): void
  assertProjectSandboxVerification(binding: ProjectSandboxBinding, verification: ProjectSandboxVerification): void
  assertProjectSandboxState(binding: ProjectSandboxBinding, state: ProjectSandboxState): void
  assertProjectSandboxHealth(binding: ProjectSandboxBinding, health: ProjectSandboxHealth): void
  assertProjectSandboxDestroyAuthorization(
    binding: ProjectSandboxBinding,
    authorization: ProjectSandboxDestroyAuthorization,
    now?: Date,
  ): void
}

async function plannedProviderModule(
  marker: string,
  ...symbols: readonly (keyof ProviderContractModule)[]
): Promise<ProviderContractModule> {
  const moduleUrl = new URL('./provider.ts', import.meta.url)
  if (!existsSync(fileURLToPath(moduleUrl))) {
    expect.fail(`PHASE1_MISSING[${marker}]`)
  }
  const modulePath = moduleUrl.href
  const planned = (await import(/* @vite-ignore */ modulePath)) as Partial<ProviderContractModule>
  for (const symbol of symbols) {
    if (typeof planned[symbol] !== 'function') expect.fail(`PHASE1_MISSING[${marker}]`)
  }
  return planned as ProviderContractModule
}

function createInput(projectId: string, projectRoot = `/projects/${projectId}`): ProjectSandboxCreateInput {
  return {
    project_id: projectId,
    project_root: projectRoot,
    image_digest: `localhost/waypoint/pi-worker@sha256:${'a'.repeat(64)}`,
    policy_hash: 'b'.repeat(64),
    mount_hash: 'c'.repeat(64),
    workspace_id: `workspace-${projectId}`,
  }
}

describe('ProjectSandboxProvider Wave 0 contracts', () => {
  it('create/inspect/verify/enter/stop/re-enter preserves only intended project state', async () => {
    const contract = await plannedProviderModule(
      'waypoint-provider.lifecycle',
      'stableProjectSandboxName',
      'assertProjectSandboxBinding',
      'assertProjectSandboxState',
      'assertProjectSandboxHealth',
    )
    const provider = new FakeProjectSandboxProvider(
      contract.stableProjectSandboxName,
      contract.assertProjectSandboxBinding,
    )

    const projectA = await provider.create(createInput('prj_opaque_a'))
    const inspected = await provider.inspect(projectA)
    expect(inspected).not.toBeNull()
    contract.assertProjectSandboxBinding(projectA, inspected!)
    contract.assertProjectSandboxState(projectA, inspected!)
    expect(await provider.verify(projectA)).toMatchObject({ enterable: true, virtualization: 'microvm' })

    await provider.enter(projectA, { argv: ['write'], write: ['state/retained.txt', 'project-a-state'] })
    await provider.stop(projectA)
    const stoppedHealth = await provider.health(projectA)
    expect(stoppedHealth).toMatchObject({ status: 'stopped', healthy: false })
    contract.assertProjectSandboxHealth(projectA, stoppedHealth)
    expect(() =>
      contract.assertProjectSandboxHealth(projectA, {
        ...stoppedHealth,
        status: 'unknown' as ProjectSandboxHealth['status'],
      }),
    ).toThrow(/invalid status/i)
    expect((await provider.enter(projectA, { argv: ['read'], read: 'state/retained.txt' })).stdout).toBe('project-a-state')

    const projectB = await provider.create(createInput('prj_opaque_b'))
    expect((await provider.enter(projectB, { argv: ['read'], read: 'state/retained.txt' })).stdout).toBe('')
    expect((await provider.enter(projectA, { argv: ['read'], read: 'state/retained.txt' })).stdout).toBe('project-a-state')
  })

  it('opaque instance identity is stable, distinct per project, and never an alias', async () => {
    const contract = await plannedProviderModule(
      'waypoint-provider.instance-identity',
      'stableProjectSandboxName',
      'assertProjectSandboxBinding',
    )
    const provider = new FakeProjectSandboxProvider(contract.stableProjectSandboxName, contract.assertProjectSandboxBinding)
    const first = await provider.create(createInput('prj_opaque_a'))
    const second = await provider.create(createInput('prj_opaque_b'))
    await expect(provider.create(createInput('prj_opaque_a', '/moved/path/must-not-change-name'))).rejects.toThrow(
      /project.path|mismatch/i,
    )

    expect(first.sandbox_instance_id).not.toBe(second.sandbox_instance_id)
    expect(first.workspace_id).not.toBe(second.workspace_id)
    expect(first.sandbox_name).not.toBe(second.sandbox_name)
    expect(first.sandbox_instance_id).not.toBe(first.provider)
    expect(first.sandbox_instance_id).not.toBe(first.sandbox_name)
    expect(first.sandbox_instance_id).not.toBe(first.project_id)
    expect(first.sandbox_instance_id).not.toBe(String(first.generation))
    expect(first.sandbox_instance_id).not.toBe(first.image_digest)
    expect(first.sandbox_instance_id).not.toBe(first.policy_hash)
    expect(first.sandbox_instance_id).not.toBe(first.mount_hash)
    expect(first.sandbox_instance_id).not.toBe(first.workspace_id)
    expect(contract.stableProjectSandboxName(first.project_id)).toBe('project-prj-opaque-a')
    expect(() => contract.stableProjectSandboxName('/projects/path-is-not-an-id')).toThrow(/opaque|project_id/i)

    const substitutions: readonly [keyof ProjectSandboxBinding, ProjectSandboxBinding[keyof ProjectSandboxBinding]][] = [
      ['project_id', second.project_id],
      ['project_root', second.project_root],
      ['provider', 'different-provider'],
      ['sandbox_instance_id', second.sandbox_instance_id],
      ['sandbox_name', second.sandbox_name],
      ['image_digest', `localhost/waypoint/pi-worker@sha256:${'d'.repeat(64)}`],
      ['policy_hash', 'd'.repeat(64)],
      ['mount_hash', 'e'.repeat(64)],
      ['generation', 2],
      ['workspace_id', second.workspace_id],
    ]
    for (const [field, value] of substitutions) {
      expect(() => contract.assertProjectSandboxBinding(first, { ...first, [field]: value })).toThrow(/binding|mismatch/i)
    }

    expect(() =>
      contract.assertValidProjectSandboxBinding({
        ...first,
        sandbox_instance_id: first.workspace_id,
      }),
    ).toThrow(/sandbox.instance|distinct/i)
    expect(() =>
      contract.assertValidProjectSandboxBinding({
        ...first,
        image_digest: 'localhost/waypoint/pi-worker:slim',
      }),
    ).toThrow(/image.digest|sha256/i)
  })

  it('mounts, environment, network, credentials, and adversarial reads fail closed', async () => {
    const contract = await plannedProviderModule(
      'waypoint-provider.forbidden-reads',
      'assertProjectSandboxVerification',
    )
    const root = await mkdtemp(path.join(tmpdir(), 'waypoint-provider-contract-'))
    const projectRoot = path.join(root, 'project-a')
    const worktree = path.join(projectRoot, 'worktrees', 'attempt-a')
    const scratch = path.join(projectRoot, '.waypoint', 'scratch', 'route-a', 'attempt-a')
    const claim = path.join(projectRoot, '.waypoint', 'claims', 'route-a')
    const forbiddenRoots = [
      path.join(root, 'portfolio-store'),
      path.join(root, 'manager-briefs'),
      path.join(root, 'project-b'),
      path.join(root, 'host-home-secrets'),
    ]
    await Promise.all([worktree, scratch, claim, ...forbiddenRoots].map((directory) => mkdir(directory, { recursive: true })))

    const mounts = await assembleSandboxMounts({
      projectRoot,
      roots: { project_worktree: { path: path.relative(projectRoot, worktree), access: 'rw' } },
      access: { project_worktree: 'rw' },
      scratchDir: scratch,
      claimDir: claim,
      mountPath: '/work',
    })
    expect(mounts.map((mount) => mount.hostPath)).not.toEqual(expect.arrayContaining(forbiddenRoots))
    expect(mounts.map((mount) => mount.hostPath).sort()).toEqual([claim, scratch, worktree].sort())

    const sandbox = {
      backend: 'microsandbox' as const,
      image: `registry.example.invalid/waypoint/worker@sha256:${'a'.repeat(64)}`,
      egress: { default: 'deny' as const, allow: ['api.model.example'] },
      credential: { broker: [{ env_var: 'MODEL_ACCESS_TOKEN', hosts: ['api.model.example'] }] },
    }
    expect(sandboxConfigProblem(sandbox, { allowRetired: true })).toBeUndefined()
    const secretValue = 'contract-secret-never-print'
    const argv = buildSandboxArgv({
      sandbox,
      argv: ['agent', '--work-order-stdin'],
      mounts,
      mountPath: '/work',
      orderSandboxPath: '/work/.waypoint/scratch/route-a/attempt-a/work-order.md',
      env: { MODEL_ACCESS_TOKEN: secretValue, WAYPOINT_ALLOW_RETIRED_MICROSANDBOX: '1' },
      msbCommand: '/approved/msb',
    })
    expect(argv).toContain('MODEL_ACCESS_TOKEN@api.model.example')
    expect(argv.join(' ')).not.toContain(secretValue)
    // Waypoint's env allowlist prepends the ~/.waypoint/bin shim dir to PATH (the
    // worker runner shim) — assert the withholding contract, not PR's exact
    // PATH value.
    const workerEnv = buildWorkerEnv({ PATH: '/usr/bin', PORTFOLIO_DATABASE_URL: 'withheld', CLOUD_ADMIN_TOKEN: 'withheld' })
    expect(Object.keys(workerEnv)).toEqual(['PATH'])
    expect(workerEnv.PATH).toMatch(/\/usr\/bin$/)

    const binding: ProjectSandboxBinding = {
      project_id: 'prj_opaque_a',
      project_root: projectRoot,
      provider: 'fake',
      sandbox_instance_id: 'fake-instance-0001',
      sandbox_name: 'project-prj-opaque-a',
      image_digest: `localhost/waypoint/pi-worker@sha256:${'a'.repeat(64)}`,
      policy_hash: 'b'.repeat(64),
      mount_hash: 'c'.repeat(64),
      generation: 1,
      workspace_id: 'workspace-0001',
    }
    const verification: ProjectSandboxVerification = {
      ...binding,
      enterable: true,
      virtualization: 'microvm',
      healthy: true,
      policy_verified: true,
      mount_policy_verified: true,
      observed_at: '2026-08-18T00:00:00.000Z',
      probes: FAKE_VERIFIED_PROBES,
    }
    expect(() => contract.assertProjectSandboxVerification(binding, verification)).not.toThrow()
    const leaked = {
      ...verification,
      probes: verification.probes.map((probe) =>
        probe.id === 'other-project-read' ? { ...probe, result: 'allowed' as const } : probe,
      ),
    }
    expect(() => contract.assertProjectSandboxVerification(binding, leaked)).toThrow(/probe|boundary|other.project/i)
    expect(() =>
      contract.assertProjectSandboxVerification(binding, {
        ...verification,
        probes: verification.probes.filter((probe) => probe.id !== 'manager-brief-read'),
      }),
    ).toThrow(/missing boundary probe|manager-brief/i)
    expect(() => contract.assertProjectSandboxVerification(binding, { ...verification, enterable: false })).toThrow(/enterable/i)
  })

  it('keeps destroy outside manager actions and requires a separately bound operator authorization', async () => {
    const contract = await plannedProviderModule(
      'waypoint-provider.operator-destroy',
      'assertProjectSandboxDestroyAuthorization',
    )
    const binding: ProjectSandboxBinding = {
      project_id: 'prj_opaque_a',
      project_root: '/projects/prj_opaque_a',
      provider: 'fake',
      sandbox_instance_id: 'fake-instance-0001',
      sandbox_name: 'project-prj-opaque-a',
      image_digest: `localhost/waypoint/pi-worker@sha256:${'a'.repeat(64)}`,
      policy_hash: 'b'.repeat(64),
      mount_hash: 'c'.repeat(64),
      generation: 1,
      workspace_id: 'workspace-prj_opaque_a',
    }
    const authorization: ProjectSandboxDestroyAuthorization = {
      action: 'sandbox.destroy',
      audience: 'operator',
      authorization_id: 'destroy-auth-0001',
      project_id: binding.project_id,
      sandbox_instance_id: binding.sandbox_instance_id,
      expires_at: '2026-08-19T00:00:00.000Z',
    }

    expect(PROJECT_SANDBOX_MANAGER_ACTIONS).not.toContain('destroy')
    expect(() => contract.assertProjectSandboxDestroyAuthorization(binding, authorization, new Date('2026-08-18T00:00:00Z'))).not.toThrow()
    expect(() =>
      contract.assertProjectSandboxDestroyAuthorization(
        binding,
        { ...authorization, sandbox_instance_id: 'forged-instance' },
        new Date('2026-08-18T00:00:00Z'),
      ),
    ).toThrow(/sandbox.instance mismatch/i)
    expect(() =>
      contract.assertProjectSandboxDestroyAuthorization(binding, authorization, new Date('2026-08-20T00:00:00Z')),
    ).toThrow(/expired/i)
  })
})
