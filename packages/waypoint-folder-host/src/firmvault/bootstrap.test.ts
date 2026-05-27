import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { WaypointBeadsCliCommandInput, WaypointBeadsCliCommandOutput, WaypointBeadsCliCommandRunner } from '../beads/cli-client.ts'
import { FIRMVAULT_REQUIRED_CASE_PATHS, inspectFirmVaultCaseFolder } from './case-folder'
import { bootstrapFirmVaultCase, createFirmVaultCaseFolder } from './bootstrap'

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

  it('bootstraps a case folder with Waypoint, FirmVault state, catalog, and an optional route', async () => {
    const casesRoot = await tempCasesRoot()

    const result = await bootstrapFirmVaultCase({
      casesRoot,
      caseName: 'Sam Client v. City Bus',
      caseType: 'personal_injury',
      startRoute: true,
      now: new Date('2026-05-08T13:00:00.000Z'),
    })

    expect(result.caseSlug).toBe('sam-client-v-city-bus')
    expect(result.project.config.quest).toBe('firmvault')
    expect(result.project.config.backend).toEqual({ route: 'folder' })
    expect(result.catalog.quest.slug).toBe('firmvault')
    expect(result.catalog.recipes.length).toBeGreaterThan(0)
    expect(result.firmvaultState.projection.landmarks.case_setup_complete.satisfied).toBe(false)
    expect(result.route?.id).toBe('route-001')
    expect(result.route?.quest).toBe('firmvault')
    expect(result.route?.backend).toBe('folder')

    expect(await pathExists(join(result.caseRoot, '.waypoint/config.yaml'))).toBe(true)
    expect(await pathExists(join(result.caseRoot, '.waypoint/quests/firmvault.yaml'))).toBe(true)
    expect(await pathExists(join(result.caseRoot, '.waypoint/firmvault/case.yaml'))).toBe(true)
    expect(await pathExists(join(result.caseRoot, '.waypoint/routes/route-001.yaml'))).toBe(true)
    expect(await pathExists(join(result.caseRoot, '.waypoint/tasks/tasks.yaml'))).toBe(true)
  })

  it('can bootstrap a case with the Beads route backend selected', async () => {
    const casesRoot = await tempCasesRoot()

    const result = await bootstrapFirmVaultCase({
      casesRoot,
      caseName: 'Beads Client v. Runtime Co',
      caseType: 'personal_injury',
      backend: 'beads',
      now: new Date('2026-05-08T13:30:00.000Z'),
    })

    expect(result.project.config.backend).toEqual({ route: 'beads' })
    expect(result.project.config.quest).toBe('firmvault')
    expect(result.route).toBeUndefined()
  })

  it('fails before creating a case when Beads start is requested without a workspace', async () => {
    const casesRoot = await tempCasesRoot()
    const runner = recordingRunner([
      {
        exitCode: 1,
        signal: null,
        stdout: JSON.stringify({
          error: 'no_beads_directory',
          message: 'No active beads workspace found.',
        }),
        stderr: '',
      },
    ])

    await expect(bootstrapFirmVaultCase({
      casesRoot,
      caseName: 'Beads Start Client',
      caseType: 'personal_injury',
      backend: 'beads',
      startRoute: true,
      beadsWorkspace: { runner },
    })).rejects.toThrow('requires an existing Beads workspace')

    expect(runner.calls[0]).toMatchObject({ args: ['where', '--json'], cwd: casesRoot })
    expect(await pathExists(join(casesRoot, 'beads-start-client'))).toBe(false)
  })

  it('can initialize a case-local Beads workspace during Beads bootstrap', async () => {
    const casesRoot = await tempCasesRoot()
    const caseRoot = join(casesRoot, 'beads-init-client')
    const runner = recordingRunner([
      {
        exitCode: 1,
        signal: null,
        stdout: JSON.stringify({
          error: 'no_beads_directory',
          message: 'No active beads workspace found.',
        }),
        stderr: '',
      },
      { exitCode: 0, signal: null, stdout: 'initialized', stderr: '' },
      {
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify({ path: join(caseRoot, '.beads'), prefix: 'beads-init-client' }),
        stderr: '',
      },
    ])

    const result = await bootstrapFirmVaultCase({
      casesRoot,
      caseName: 'Beads Init Client',
      caseType: 'personal_injury',
      backend: 'beads',
      initBeads: true,
      beadsWorkspace: { runner },
      now: new Date('2026-05-08T13:45:00.000Z'),
    })

    expect(result.caseRoot).toBe(caseRoot)
    expect(result.project.config.backend).toEqual({ route: 'beads' })
    expect(result.route).toBeUndefined()
    expect(runner.calls.map((call) => ({ args: call.args, cwd: call.cwd }))).toEqual([
      { args: ['where', '--json'], cwd: casesRoot },
      { args: ['init', '--non-interactive', '--skip-agents', '--skip-hooks', '--prefix', 'beads-init-client'], cwd: caseRoot },
      { args: ['where', '--json'], cwd: caseRoot },
    ])
  })
})

function recordingRunner(outputs: readonly WaypointBeadsCliCommandOutput[]): WaypointBeadsCliCommandRunner & {
  readonly calls: WaypointBeadsCliCommandInput[]
} {
  const calls: WaypointBeadsCliCommandInput[] = []
  return {
    calls,
    async run(input) {
      calls.push(input)
      const output = outputs[calls.length - 1]
      if (!output) throw new Error(`Unexpected command: ${input.command} ${input.args.join(' ')}`)
      return output
    },
  }
}
