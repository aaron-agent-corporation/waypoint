import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { initWaypointProject } from '../project/init'
import {
  addLifecycleMilestone,
  addLifecyclePhase,
  addLifecyclePlan,
  addLifecycleWorkstream,
  listLifecycleState,
} from './store'

async function tempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'runner-lifecycle-'))
  await initWaypointProject(projectRoot, { quest: 'runner' })
  return projectRoot
}

describe('folder lifecycle YAML store', () => {
  it('creates and lists workstreams with duplicate-key validation', async () => {
    const projectRoot = await tempProject()

    const workstream = await addLifecycleWorkstream(projectRoot, { key: 'core', name: 'Core' })

    expect(workstream).toMatchObject({ id: 'workstream-001', key: 'core', name: 'Core' })

    const yaml = yamlParse(await readFile(join(projectRoot, '.waypoint/lifecycle/workstreams.yaml'), 'utf8')) as {
      workstreams: Array<Record<string, unknown>>
    }
    expect(yaml.workstreams).toHaveLength(1)
    expect(yaml.workstreams[0]).toMatchObject({ id: 'workstream-001', key: 'core', name: 'Core' })

    await expect(addLifecycleWorkstream(projectRoot, { key: 'core', name: 'Duplicate' })).rejects.toThrow(
      'Lifecycle workstream already exists: core',
    )

    const state = await listLifecycleState(projectRoot)
    expect(state.workstreams.map((entry) => entry.key)).toEqual(['core'])
  })

  it('creates milestones, phases, and plans with parent validation', async () => {
    const projectRoot = await tempProject()
    await addLifecycleWorkstream(projectRoot, { key: 'core', name: 'Core' })

    await expect(
      addLifecycleMilestone(projectRoot, { workstream: 'missing', key: 'v1', title: 'First Release' }),
    ).rejects.toThrow('Lifecycle workstream does not exist: missing')

    const milestone = await addLifecycleMilestone(projectRoot, {
      workstream: 'core',
      key: 'v1',
      title: 'First Release',
    })
    expect(milestone).toMatchObject({ id: 'milestone-001', workstream: 'core', key: 'v1' })

    await expect(
      addLifecyclePhase(projectRoot, { milestone: 'missing', key: 'execute', lifecycle: 'execute' }),
    ).rejects.toThrow('Lifecycle milestone does not exist: missing')

    const phase = await addLifecyclePhase(projectRoot, { milestone: 'v1', key: 'execute', lifecycle: 'execute' })
    expect(phase).toMatchObject({ id: 'phase-001', milestone: 'v1', key: 'execute', lifecycle: 'execute' })

    await expect(
      addLifecyclePlan(projectRoot, { phase: 'missing', ref: 'P-1', title: 'Build intake form' }),
    ).rejects.toThrow('Lifecycle phase does not exist: missing')

    const plan = await addLifecyclePlan(projectRoot, { phase: 'execute', ref: 'P-1', title: 'Build intake form' })
    expect(plan).toMatchObject({ id: 'plan-001', phase: 'execute', ref: 'P-1', title: 'Build intake form' })

    const state = await listLifecycleState(projectRoot)
    expect(state).toMatchObject({
      workstreams: [{ key: 'core' }],
      milestones: [{ key: 'v1', workstream: 'core' }],
      phases: [{ key: 'execute', milestone: 'v1' }],
      plans: [{ ref: 'P-1', phase: 'execute' }],
    })
  })
})
