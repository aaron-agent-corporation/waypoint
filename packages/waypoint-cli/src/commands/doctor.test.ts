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
})
