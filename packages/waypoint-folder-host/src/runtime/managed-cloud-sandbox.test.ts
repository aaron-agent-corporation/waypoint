import { describe, expect, it } from 'vitest'

import {
  buildCloudEnterArgv,
  projectSandboxBindingFromManagedRoute,
} from './managed-cloud-sandbox.ts'

const VALID_MANAGED = {
  project_id: 'prj_test123',
  sandbox_instance_id: 'sprite-instance-1',
  sandbox_image: `ghcr.io/example/worker@sha256:${'a'.repeat(64)}`,
  sandbox_policy: 'b'.repeat(64),
  sandbox_mount: 'c'.repeat(64),
  sandbox_workspace: 'workspace-a',
  sandbox_generation: 3,
  sandbox_provider: 'fly-sprites',
} as const

describe('projectSandboxBindingFromManagedRoute', () => {
  it('maps admitted route metadata to a ProjectSandboxBinding', () => {
    const binding = projectSandboxBindingFromManagedRoute(
      VALID_MANAGED,
      '/tmp/case',
      'fly-sprites',
    )
    expect(binding.project_id).toBe('prj_test123')
    expect(binding.project_root).toBe('/tmp/case')
    expect(binding.provider).toBe('fly-sprites')
    expect(binding.sandbox_name).toBe('project-prj-test123')
    expect(binding.generation).toBe(3)
    expect(binding.workspace_id).toBe('workspace-a')
  })

  it('refuses incomplete metadata', () => {
    expect(() =>
      projectSandboxBindingFromManagedRoute({ project_id: 'prj_x' }, '/tmp/case', 'fly-sprites'),
    ).toThrow(/missing sandbox_instance_id/)
  })
})

describe('buildCloudEnterArgv', () => {
  it('redirects the staged order onto stdin inside the guest workdir', () => {
    const argv = buildCloudEnterArgv({
      agentArgv: ['claude', '-p'],
      mountPath: '/work',
      orderSandboxPath: '/work/.waypoint/scratch/route-001/task-1/work-order.md',
      workOrderVia: 'stdin',
      workOrder: 'ignored for stdin path',
    })
    expect(argv).toEqual([
      '/bin/sh',
      '-lc',
      "cd '/work' && 'claude' '-p' < '/work/.waypoint/scratch/route-001/task-1/work-order.md'",
    ])
  })

  it('inlines staged guest credential env before cd', () => {
    const argv = buildCloudEnterArgv({
      agentArgv: ['claude', '-p'],
      mountPath: '/work',
      orderSandboxPath: '/work/.waypoint/scratch/route-001/task-1/work-order.md',
      workOrderVia: 'stdin',
      workOrder: 'ignored for stdin path',
      guestEnv: {
        CLAUDE_CONFIG_DIR: '/home/sprite/.waypoint/lane-creds/claude-aaron',
      },
    })
    expect(argv[2]).toBe(
      "export CLAUDE_CONFIG_DIR='/home/sprite/.waypoint/lane-creds/claude-aaron'; cd '/work' && 'claude' '-p' < '/work/.waypoint/scratch/route-001/task-1/work-order.md'",
    )
  })

  it('always redirects the staged order file in cloud (never inline — Sprites exec URL limit)', () => {
    const argv = buildCloudEnterArgv({
      agentArgv: ['kimi', '-p'],
      mountPath: '/work',
      orderSandboxPath: '/work/.waypoint/scratch/route-001/task-1/work-order.md',
      workOrderVia: 'arg',
      workOrder: 'do the thing',
    })
    expect(argv[2]).toBe(
      "cd '/work' && 'kimi' '-p' < '/work/.waypoint/scratch/route-001/task-1/work-order.md'",
    )
  })
})
