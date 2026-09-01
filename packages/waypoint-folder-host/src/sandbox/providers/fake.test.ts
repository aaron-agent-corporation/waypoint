import { describe, expect, it } from 'vitest'

import { createProjectSandboxProvider } from './cloud.ts'
import { FakeProjectSandboxProvider, FAKE_PROVIDER_KIND } from './fake.ts'

describe('FakeProjectSandboxProvider', () => {
  it('implements lifecycle without network or credentials', async () => {
    const provider = new FakeProjectSandboxProvider()
    expect(provider.provider).toBe(FAKE_PROVIDER_KIND)

    const created = await provider.create({
      project_id: 'prj_fake_a',
      project_root: '/tmp/prj_fake_a',
      workspace_id: 'workspace-fake-a',
      image_digest: `localhost/waypoint/fake@sha256:${'a'.repeat(64)}`,
      policy_hash: 'b'.repeat(64),
      mount_hash: 'c'.repeat(64),
    })
    expect(created.sandbox_instance_id).toMatch(/^fake-instance-/)
    expect(created.sandbox_name).toBe('project-prj-fake-a')

    const inspected = await provider.inspect(created)
    expect(inspected?.sandbox_instance_id).toBe(created.sandbox_instance_id)

    const verified = await provider.verify(created)
    expect(verified.healthy).toBe(true)
    expect(verified.probes.some((probe) => probe.id === 'denied-host-egress' && probe.result === 'denied')).toBe(
      true,
    )

    const entered = await provider.enter(created, { argv: ['/bin/echo', 'ok'] })
    expect(entered.exit_code).toBe(0)

    await provider.stop(created)
    const health = await provider.health(created)
    expect(health.status).toBe('stopped')
  })

  it('is returned by createProjectSandboxProvider(fake)', () => {
    expect(createProjectSandboxProvider('fake')).toBeInstanceOf(FakeProjectSandboxProvider)
  })
})
