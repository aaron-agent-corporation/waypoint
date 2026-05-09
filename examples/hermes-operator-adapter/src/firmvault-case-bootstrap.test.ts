import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createFirmVaultCaseWithHermesOperator,
  parseFirmVaultCasesRegistry,
  recordFirmVaultDocumentHandoffWithHermesOperator,
  addFirmVaultDocumentWithHermesOperator,
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

  it('maps trusted document intake and handoff requests to exact FirmVault CLI args', async () => {
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
      if (spec.args.includes('add-document')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            document_id: 'document-001',
            kind: 'unknown',
            path: 'documents/inbox/daily-mail.pdf',
            original_name: 'daily-mail.pdf',
            added_at: '2026-05-08T12:00:00.000Z',
            note: 'Daily Mail scan',
          }),
          stderr: '',
        }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          document_id: 'document-001',
          handoff: {
            system: 'firmvault-document-pipeline',
            status: 'pr_opened',
            pr_number: 123,
            pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/123',
            branch: 'ingest/2026-05-08-deadbeef',
          },
        }),
        stderr: '',
      }
    }

    const added = await addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      source: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
      note: 'Daily Mail scan',
    }, { executor })
    const handoff = await recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: added.documentId,
      status: 'pr_opened',
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
    }, { executor })

    expect(added).toMatchObject({
      ok: true,
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      documentId: 'document-001',
      path: 'documents/inbox/daily-mail.pdf',
      summary: 'FirmVault document document-001 added to jane-smith-v-acme-trucking through Hermes profile paralegal.',
    })
    expect(handoff).toMatchObject({
      ok: true,
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      documentId: 'document-001',
      status: 'pr_opened',
      summary: 'FirmVault document document-001 handoff recorded as pr_opened for jane-smith-v-acme-trucking.',
    })
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          waypointCli,
          'firmvault',
          'add-document',
          '--source',
          '/trusted/scans/daily-mail.pdf',
          '--kind',
          'unknown',
          '--note',
          'Daily Mail scan',
          '--json',
        ],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
      {
        command: process.execPath,
        args: [
          waypointCli,
          'firmvault',
          'document-handoff',
          '--document-id',
          'document-001',
          '--status',
          'pr-opened',
          '--pr-number',
          '123',
          '--pr-url',
          'http://localhost:3001/aaron/FirmVault/pulls/123',
          '--branch',
          'ingest/2026-05-08-deadbeef',
          '--json',
        ],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
    ])
  })

  it('rejects unsafe FirmVault document adapter inputs before invoking Waypoint', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const executor: WaypointCommandExecutor = async () => {
      throw new Error('executor should not be called')
    }

    await expect(addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: '../escape',
      source: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
    }, { executor })).rejects.toThrow('Invalid FirmVault case slug: ../escape')
    await expect(addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      source: 'daily-mail.pdf',
      kind: 'unknown',
    }, { executor })).rejects.toThrow('FirmVault document source must be an absolute path')
    await expect(recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      status: 'bogus' as never,
    }, { executor })).rejects.toThrow('Unsupported FirmVault document handoff status: bogus')
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
