import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { FIRMVAULT_REQUIRED_CASE_PATHS } from '@waypoint/folder-host'

async function tempCaseFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-doctor-'))
}

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

async function createPath(root: string, relativePath: string): Promise<void> {
  const fullPath = join(root, relativePath)
  if (relativePath.endsWith('/')) {
    await mkdir(fullPath, { recursive: true })
    return
  }
  await mkdir(join(fullPath, '..'), { recursive: true })
  await writeFile(fullPath, `# ${relativePath}\n`)
}

async function createCompleteMinimalCase(root: string): Promise<void> {
  for (const relativePath of FIRMVAULT_REQUIRED_CASE_PATHS) {
    await createPath(root, relativePath)
  }
  await writeFile(join(root, 'jane-doe.md'), '# Jane Doe\n')
}

describe('waypoint doctor command', () => {
  it('prints FirmVault case-folder diagnostics', async () => {
    const cwd = await tempCaseFolder()
    await createCompleteMinimalCase(cwd)
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['doctor', 'firmvault'], io)).toBe(0)

    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Waypoint FirmVault doctor')
    expect(output).toContain(`folder: ${cwd}`)
    expect(output).toContain('looks_like_firmvault_case: true')
    expect(output).toContain('case_slug: jane-doe')
    expect(output).toContain('missing required paths: none')
  })

  it('can emit FirmVault diagnostics as JSON', async () => {
    const cwd = await tempCaseFolder()
    await writeFile(join(cwd, 'jane-doe.md'), '# Jane Doe\n')
    const { io, stdout, stderr } = makeIo(cwd)

    expect(await runWaypointCli(['doctor', 'firmvault', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as Record<string, unknown>
    expect(parsed).toMatchObject({
      root: cwd,
      looksLikeFirmVaultCase: false,
      caseSlug: 'jane-doe',
    })
    expect(parsed.missingRequiredPaths).toEqual(expect.arrayContaining(['Dashboard.md', 'workflow-log/index.md']))
  })

  it('does not mutate the inspected folder', async () => {
    const cwd = await tempCaseFolder()
    const before = await readdir(cwd)
    const { io } = makeIo(cwd)

    expect(await runWaypointCli(['doctor', 'firmvault'], io)).toBe(0)

    expect(await readdir(cwd)).toEqual(before)
  })

  it('emits paralegal operator readiness diagnostics with an explicit profile', async () => {
    const workspaceRoot = await tempCaseFolder()
    await mkdir(join(workspaceRoot, 'waypoint_cases'), { recursive: true })
    await mkdir(join(workspaceRoot, 'cases'), { recursive: true })
    const repoRoot = join(__dirname, '../../../..')
    const { io, stdout, stderr } = makeIo(repoRoot)

    expect(
      await runWaypointCli(['doctor', 'firmvault', '--profile', 'paralegal', '--workspace-root', workspaceRoot, '--json'], io),
    ).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { profile: string; ready: boolean; checks: Array<{ slug: string; status: string }> }
    expect(parsed.profile).toBe('paralegal')
    expect(parsed.ready).toBe(true)
    expect(parsed).not.toHaveProperty('upgrade_plan')
    expect(parsed.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'waypoint_cases_root', status: 'pass' }),
        expect.objectContaining({ slug: 'operator_manifest', status: 'pass' }),
        expect.objectContaining({ slug: 'case_export_script', status: 'pass' }),
      ]),
    )
  })

  it('emits a non-mutating paralegal upgrade plan only when requested', async () => {
    const workspaceRoot = await tempCaseFolder()
    const repoRoot = join(__dirname, '../../../..')
    const { io, stdout, stderr } = makeIo(repoRoot)

    expect(
      await runWaypointCli(['doctor', 'firmvault', '--profile', 'paralegal', '--workspace-root', workspaceRoot, '--json', '--upgrade-plan'], io),
    ).toBe(1)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as {
      profile: string
      ready: boolean
      upgrade_plan: { mutates: boolean; steps: Array<{ slug: string; command: string }> }
    }
    expect(parsed.profile).toBe('paralegal')
    expect(parsed.ready).toBe(false)
    expect(parsed.upgrade_plan.mutates).toBe(false)
    expect(parsed.upgrade_plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'create_waypoint_cases_root', command: `mkdir -p ${JSON.stringify(join(workspaceRoot, 'waypoint_cases'))}` }),
        expect.objectContaining({ slug: 'create_source_cases_root' }),
      ]),
    )
  })
})
