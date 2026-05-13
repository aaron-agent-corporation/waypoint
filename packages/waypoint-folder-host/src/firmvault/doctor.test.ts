import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inspectFirmVaultOperatorReadiness } from './doctor'

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-doctor-'))
}

async function createRepoFixture(root: string): Promise<void> {
  await mkdir(join(root, 'operators/firmvault'), { recursive: true })
  await writeFile(join(root, 'operators/firmvault/paralegal.yaml'), 'schema_version: 1\nslug: firmvault-paralegal\n')
  await mkdir(join(root, 'scripts'), { recursive: true })
  await writeFile(join(root, 'scripts/firmvault-waypoint-case-export.mjs'), '#!/usr/bin/env node\n')
  await writeFile(join(root, 'scripts/firmvault-folder-smoke.mjs'), '#!/usr/bin/env node\n')
  await writeFile(join(root, 'scripts/firmvault-staged-case-guidance-smoke.mjs'), '#!/usr/bin/env node\n')
  await writeFile(join(root, 'scripts/firmvault-completed-case-replay.mjs'), '#!/usr/bin/env node\n')
}

describe('FirmVault operator readiness doctor', () => {
  it('passes a configured paralegal workspace without mutating it', async () => {
    const workspaceRoot = await makeTempRoot()
    const repoRoot = await makeTempRoot()
    const skillRoot = await makeTempRoot()
    const skillPath = join(skillRoot, 'firmvault-waypoint-case-operations/SKILL.md')
    await mkdir(join(workspaceRoot, 'waypoint_cases'), { recursive: true })
    await mkdir(join(workspaceRoot, 'cases'), { recursive: true })
    await mkdir(join(skillPath, '..'), { recursive: true })
    await writeFile(skillPath, '# FirmVault Waypoint Case Operations\n')
    await createRepoFixture(repoRoot)

    const result = await inspectFirmVaultOperatorReadiness({
      profile: 'paralegal',
      workspaceRoot,
      repoRoot,
      paralegalSkillPath: skillPath,
    })

    expect(result.profile).toBe('paralegal')
    expect(result.ready).toBe(true)
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'waypoint_cases_root', status: 'pass', path: join(workspaceRoot, 'waypoint_cases') }),
        expect.objectContaining({ slug: 'source_cases_root', status: 'pass', path: join(workspaceRoot, 'cases') }),
        expect.objectContaining({ slug: 'paralegal_skill', status: 'pass', path: skillPath }),
        expect.objectContaining({ slug: 'operator_manifest', status: 'pass', path: join(repoRoot, 'operators/firmvault/paralegal.yaml') }),
        expect.objectContaining({ slug: 'case_export_script', status: 'pass', path: join(repoRoot, 'scripts/firmvault-waypoint-case-export.mjs') }),
        expect.objectContaining({ slug: 'smoke_scripts', status: 'pass' }),
      ]),
    )
  })

  it('warns for optional legacy inputs but fails when the Waypoint cases root is missing', async () => {
    const workspaceRoot = await makeTempRoot()
    const repoRoot = await makeTempRoot()
    await createRepoFixture(repoRoot)

    const result = await inspectFirmVaultOperatorReadiness({
      profile: 'paralegal',
      workspaceRoot,
      repoRoot,
      paralegalSkillPath: join(workspaceRoot, 'missing-skill/SKILL.md'),
    })

    expect(result.ready).toBe(false)
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'waypoint_cases_root', status: 'fail', next_action: 'Create the Waypoint case root before exporting or bootstrapping cases.' }),
        expect.objectContaining({ slug: 'source_cases_root', status: 'warn' }),
        expect.objectContaining({ slug: 'paralegal_skill', status: 'warn' }),
      ]),
    )
  })

  it('omits upgrade steps by default and emits non-mutating upgrade plans when requested', async () => {
    const workspaceRoot = await makeTempRoot()
    const repoRoot = await makeTempRoot()
    await createRepoFixture(repoRoot)

    const withoutPlan = await inspectFirmVaultOperatorReadiness({
      profile: 'paralegal',
      workspaceRoot,
      repoRoot,
      paralegalSkillPath: join(workspaceRoot, 'missing-skill/SKILL.md'),
    })
    expect(withoutPlan).not.toHaveProperty('upgrade_plan')

    const withPlan = await inspectFirmVaultOperatorReadiness({
      profile: 'paralegal',
      workspaceRoot,
      repoRoot,
      paralegalSkillPath: join(workspaceRoot, 'missing-skill/SKILL.md'),
      includeUpgradePlan: true,
    })

    expect(withPlan.ready).toBe(false)
    expect(withPlan.upgrade_plan).toEqual({
      mutates: false,
      steps: expect.arrayContaining([
        expect.objectContaining({
          slug: 'create_waypoint_cases_root',
          command: `mkdir -p ${JSON.stringify(join(workspaceRoot, 'waypoint_cases'))}`,
          reason: 'Required before exporting or bootstrapping FirmVault cases.',
        }),
        expect.objectContaining({
          slug: 'create_source_cases_root',
          command: `mkdir -p ${JSON.stringify(join(workspaceRoot, 'cases'))}`,
        }),
        expect.objectContaining({
          slug: 'install_paralegal_skill',
          command: 'hermes skills install firmvault-waypoint-case-operations --profile paralegal',
        }),
      ]),
    })
  })

  it('returns an empty non-mutating upgrade plan for a ready workspace', async () => {
    const workspaceRoot = await makeTempRoot()
    const repoRoot = await makeTempRoot()
    const skillRoot = await makeTempRoot()
    const skillPath = join(skillRoot, 'firmvault-waypoint-case-operations/SKILL.md')
    await mkdir(join(workspaceRoot, 'waypoint_cases'), { recursive: true })
    await mkdir(join(workspaceRoot, 'cases'), { recursive: true })
    await mkdir(join(skillPath, '..'), { recursive: true })
    await writeFile(skillPath, '# FirmVault Waypoint Case Operations\n')
    await createRepoFixture(repoRoot)

    const result = await inspectFirmVaultOperatorReadiness({
      profile: 'paralegal',
      workspaceRoot,
      repoRoot,
      paralegalSkillPath: skillPath,
      includeUpgradePlan: true,
    })

    expect(result.ready).toBe(true)
    expect(result.upgrade_plan).toEqual({ mutates: false, steps: [] })
  })

  it('rejects unsupported profiles without checking external services', async () => {
    const result = await inspectFirmVaultOperatorReadiness({ profile: 'attorney', workspaceRoot: await makeTempRoot(), repoRoot: await makeTempRoot(), includeUpgradePlan: true })

    expect(result.ready).toBe(false)
    expect(result.upgrade_plan).toEqual({ mutates: false, steps: [expect.objectContaining({ slug: 'use_supported_profile' })] })
    expect(result.checks).toEqual([
      expect.objectContaining({ slug: 'profile', status: 'fail', message: 'Unsupported FirmVault doctor profile: attorney' }),
    ])
  })
})
