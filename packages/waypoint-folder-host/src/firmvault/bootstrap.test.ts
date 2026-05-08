import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FIRMVAULT_REQUIRED_CASE_PATHS, inspectFirmVaultCaseFolder } from './case-folder'
import { createFirmVaultCaseFolder } from './bootstrap'

async function tempCasesRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-cases-'))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

describe('createFirmVaultCaseFolder', () => {
  it('creates a canonical personal-injury case folder from a case name', async () => {
    const casesRoot = await tempCasesRoot()

    const result = await createFirmVaultCaseFolder({
      casesRoot,
      caseName: 'Jane Smith v. Acme Trucking',
      caseType: 'personal_injury',
      now: new Date('2026-05-08T12:00:00.000Z'),
    })

    expect(result.caseSlug).toBe('jane-smith-v-acme-trucking')
    expect(result.caseRoot).toBe(join(casesRoot, 'jane-smith-v-acme-trucking'))
    expect(result.createdPaths).toEqual(expect.arrayContaining([
      'AGENTS.md',
      'Dashboard.md',
      'jane-smith-v-acme-trucking.md',
      ...FIRMVAULT_REQUIRED_CASE_PATHS,
    ]))

    for (const relativePath of FIRMVAULT_REQUIRED_CASE_PATHS) {
      expect(await pathExists(join(result.caseRoot, relativePath))).toBe(true)
    }

    const caseIndex = await readFile(join(result.caseRoot, 'jane-smith-v-acme-trucking.md'), 'utf8')
    expect(caseIndex).toContain('case_slug: jane-smith-v-acme-trucking')
    expect(caseIndex).toContain('case_type: personal_injury')
    expect(caseIndex).toContain('# Jane Smith v. Acme Trucking')

    const inspection = await inspectFirmVaultCaseFolder(result.caseRoot)
    expect(inspection.looksLikeFirmVaultCase).toBe(true)
    expect(inspection.caseSlug).toBe('jane-smith-v-acme-trucking')
    expect(inspection.missingRequiredPaths).toEqual([])
  })

  it('rejects unsafe slugs and existing folders by default', async () => {
    const casesRoot = await tempCasesRoot()
    await mkdir(join(casesRoot, 'existing-case'), { recursive: true })

    await expect(createFirmVaultCaseFolder({
      casesRoot,
      caseName: 'Escape',
      caseType: 'personal_injury',
      caseSlug: '../escape',
    })).rejects.toThrow('Unsafe FirmVault case slug')

    await expect(createFirmVaultCaseFolder({
      casesRoot,
      caseName: 'Existing Case',
      caseType: 'personal_injury',
      caseSlug: 'existing-case',
    })).rejects.toThrow('FirmVault case folder already exists')
  })
})
