import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createFirmVaultCaseWithHermesOperator,
  parseFirmVaultCasesRegistry,
  type FirmVaultNewCaseRequest,
} from './firmvault-case-bootstrap.ts'
import type { WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')

describe('FirmVault Hermes case bootstrap adapter', () => {
  it('maps a trusted structured request to the exact FirmVault bootstrap CLI args and paralegal Hermes profile', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: WaypointCommandExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          case_root: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
          case_slug: 'jane-smith-v-acme-trucking',
          quest: 'firmvault',
          route_id: 'route-001',
          created_paths: ['AGENTS.md'],
          recipes_installed: 52,
          landmarks: { satisfied: 0, total: 82 },
        }),
        stderr: '',
      }
    }

    const result = await createFirmVaultCaseWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseName: 'Jane Smith v. Acme Trucking',
      caseType: 'personal_injury',
      start: true,
    }, { executor })

    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          waypointCli,
          'firmvault',
          'bootstrap',
          '--cases-root',
          '/trusted/firmvault/cases',
          '--case-name',
          'Jane Smith v. Acme Trucking',
          '--case-type',
          'personal-injury',
          '--start',
          '--json',
        ],
        cwd: '/trusted/firmvault/cases',
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      casesRootKey: 'pi',
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      caseSlug: 'jane-smith-v-acme-trucking',
      routeId: 'route-001',
      landmarkCount: 82,
      summary: 'FirmVault case jane-smith-v-acme-trucking bootstrapped under pi with Hermes profile paralegal.',
    })
  })

  it('rejects unknown cases root keys and natural-language path attempts', () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)

    expect(() =>
      createFirmVaultCaseWithHermesOperator(registry, {
        casesRootKey: '/trusted/firmvault/cases',
        caseName: 'Jane Smith v. Acme Trucking',
        caseType: 'personal_injury',
      }),
    ).toThrow('Unknown FirmVault cases root key: /trusted/firmvault/cases')

    expect(() =>
      parseFirmVaultCasesRegistry(`
cases_roots:
  '../escape':
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`),
    ).toThrow('Invalid FirmVault cases root key: ../escape')
  })

  it('requires FirmVault bootstrap to be routed through the paralegal Hermes profile', () => {
    expect(() =>
      parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: gary
`),
    ).toThrow('FirmVault cases root pi must use Hermes profile paralegal')
  })

  it('can bootstrap a real temp FirmVault case through the adapter and actual CLI', async () => {
    const casesRoot = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-firmvault-cases-'))
    try {
      const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: ${casesRoot}
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
      const request: FirmVaultNewCaseRequest = {
        casesRootKey: 'pi',
        caseName: 'Smoke Client v. Adapter Co',
        caseType: 'personal_injury',
        start: true,
      }

      const result = await createFirmVaultCaseWithHermesOperator(registry, request)

      expect(result.ok).toBe(true)
      expect(result.hermesProfile).toBe('paralegal')
      expect(result.caseSlug).toBe('smoke-client-v-adapter-co')
      expect(result.routeId).toBe('route-001')
      expect(result.landmarkCount).toBe(82)
      expect(existsSync(join(casesRoot, 'smoke-client-v-adapter-co/.waypoint/routes/route-001.yaml'))).toBe(true)
      expect(existsSync(join(casesRoot, 'smoke-client-v-adapter-co/.waypoint/tasks/tasks.yaml'))).toBe(true)
    } finally {
      rmSync(casesRoot, { recursive: true, force: true })
    }
  }, 20000)
})
