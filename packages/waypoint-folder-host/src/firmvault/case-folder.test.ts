import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FIRMVAULT_REQUIRED_CASE_PATHS, inspectFirmVaultCaseFolder } from './case-folder'

async function tempCaseFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-case-'))
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
  await writeFile(join(root, 'jane-doe.md'), '---\ncase_slug: jane-doe\n---\n# Jane Doe\n')
}

describe('inspectFirmVaultCaseFolder', () => {
  it('recognizes a complete minimal FirmVault-style case folder', async () => {
    const root = await tempCaseFolder()
    await createCompleteMinimalCase(root)

    const result = await inspectFirmVaultCaseFolder(root)

    expect(result.root).toBe(root)
    expect(result.looksLikeFirmVaultCase).toBe(true)
    expect(result.caseSlug).toBe('jane-doe')
    expect(result.missingRequiredPaths).toEqual([])
    expect(result.presentRequiredPaths).toEqual(expect.arrayContaining([...FIRMVAULT_REQUIRED_CASE_PATHS]))
    expect(result.warnings).toEqual([])
  })

  it('reports missing starter paths by relative path', async () => {
    const root = await tempCaseFolder()
    await createCompleteMinimalCase(root)
    await mkdir(join(root, 'client'), { recursive: true })
    await writeFile(join(root, 'client/intake.md'), '# Intake\n')

    const incompleteRoot = await tempCaseFolder()
    await writeFile(join(incompleteRoot, 'jane-doe.md'), '# Jane Doe\n')
    await mkdir(join(incompleteRoot, 'client'), { recursive: true })
    await writeFile(join(incompleteRoot, 'client/intake.md'), '# Intake\n')

    const result = await inspectFirmVaultCaseFolder(incompleteRoot)

    expect(result.looksLikeFirmVaultCase).toBe(false)
    expect(result.caseSlug).toBe('jane-doe')
    expect(result.presentRequiredPaths).toContain('client/')
    expect(result.presentRequiredPaths).toContain('client/intake.md')
    expect(result.missingRequiredPaths).toContain('Dashboard.md')
    expect(result.missingRequiredPaths).toContain('workflow-log/index.md')
    expect(result.missingRequiredPaths).not.toContain('client/intake.md')
  })

  it('does not recognize or mutate an empty folder', async () => {
    const root = await tempCaseFolder()
    const before = await readdir(root)

    const result = await inspectFirmVaultCaseFolder(root)

    const after = await readdir(root)
    expect(result.looksLikeFirmVaultCase).toBe(false)
    expect(result.caseSlug).toBeNull()
    expect(result.presentRequiredPaths).toEqual([])
    expect(result.missingRequiredPaths).toEqual(FIRMVAULT_REQUIRED_CASE_PATHS)
    expect(result.warnings).toContain('No plausible case index markdown file found in the folder root.')
    expect(after).toEqual(before)
  })

  it('recognizes the source template shell before a case-specific index file is renamed in', async () => {
    const root = await tempCaseFolder()
    for (const relativePath of FIRMVAULT_REQUIRED_CASE_PATHS) {
      await createPath(root, relativePath)
    }
    await writeFile(join(root, '_case-slug.md'), '# Template case index\n')

    const result = await inspectFirmVaultCaseFolder(root)

    expect(result.looksLikeFirmVaultCase).toBe(true)
    expect(result.caseSlug).toBeNull()
    expect(result.caseIndexCandidates).toEqual([])
    expect(result.missingRequiredPaths).toEqual([])
    expect(result.warnings).toContain('No plausible case index markdown file found in the folder root.')
  })

  it('reports ambiguous case index markdown files instead of guessing', async () => {
    const root = await tempCaseFolder()
    await createCompleteMinimalCase(root)
    await writeFile(join(root, 'john-smith.md'), '# John Smith\n')

    const result = await inspectFirmVaultCaseFolder(root)

    expect(result.looksLikeFirmVaultCase).toBe(false)
    expect(result.caseSlug).toBeNull()
    expect(result.warnings).toContain('Multiple plausible case index markdown files found: jane-doe.md, john-smith.md.')
  })
})
