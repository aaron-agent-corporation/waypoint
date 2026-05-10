import { describe, expect, it } from 'vitest'

import { parseFirmVaultCasesRegistry } from './firmvault-case-bootstrap.ts'
import {
  syncFirmVaultDocumentPrStatusWithHermesOperator,
  type FirmVaultDocumentPrStatusClient,
} from './firmvault-document-pr-sync.ts'
import type { WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

const waypointCli = '/trusted/bin/waypoint'

function trustedRegistry() {
  return parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
}

describe('FirmVault document PR sync adapter', () => {
  it('records merged handoff status when Forgejo reports a merged PR', async () => {
    const registry = trustedRegistry()
    const prClientCalls: Array<{ prNumber?: number; prUrl?: string; branch?: string }> = []
    const prClient: FirmVaultDocumentPrStatusClient = async (lookup) => {
      prClientCalls.push(lookup)
      return {
        state: 'merged',
        prNumber: 123,
        prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
        branch: 'ingest/2026-05-08-deadbeef',
        mergedAt: '2026-05-08T13:00:00.000Z',
      }
    }
    const waypointCalls: Array<{ args: readonly string[]; cwd: string }> = []
    const waypointExecutor: WaypointCommandExecutor = async (spec) => {
      waypointCalls.push({ args: spec.args, cwd: spec.cwd })
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          document_id: 'document-001',
          handoff: {
            system: 'firmvault-document-pipeline',
            status: 'merged',
            pr_number: 123,
            pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/123',
            branch: 'ingest/2026-05-08-deadbeef',
            completed_at: '2026-05-08T13:00:00.000Z',
          },
        }),
        stderr: '',
      }
    }

    const result = await syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      handoff: {
        status: 'pr_opened',
        prNumber: 123,
        prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
        branch: 'ingest/2026-05-08-deadbeef',
      },
    }, { prClient, waypointExecutor })

    expect(result).toMatchObject({
      ok: true,
      casesRootKey: 'pi',
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      previousStatus: 'pr_opened',
      nextStatus: 'merged',
      changed: true,
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
      completedAt: '2026-05-08T13:00:00.000Z',
      legalLandmarksUpdated: false,
      summary: 'FirmVault document document-001 PR sync recorded merged; legal landmarks unchanged.',
    })
    expect(prClientCalls).toEqual([{
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
    }])
    expect(waypointCalls).toHaveLength(1)
    expect(waypointCalls[0].cwd).toBe('/trusted/firmvault/cases/jane-smith-v-acme-trucking')
    expect(waypointCalls[0].args).toEqual([
      waypointCli,
      'firmvault',
      'document-handoff',
      '--document-id',
      'document-001',
      '--status',
      'merged',
      '--pr-number',
      '123',
      '--pr-url',
      'http://localhost:3001/aaron/FirmVault/pulls/123',
      '--branch',
      'ingest/2026-05-08-deadbeef',
      '--completed-at',
      '2026-05-08T13:00:00.000Z',
      '--json',
    ])
  })

  it('leaves an open PR unchanged and does not write a duplicate handoff event', async () => {
    const registry = trustedRegistry()
    const prClient: FirmVaultDocumentPrStatusClient = async () => ({
      state: 'open',
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
    })
    const waypointExecutor: WaypointCommandExecutor = async () => {
      throw new Error('waypoint executor should not be called for unchanged open PRs')
    }

    const result = await syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      handoff: {
        status: 'pr_opened',
        prNumber: 123,
        prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
        branch: 'ingest/2026-05-08-deadbeef',
      },
    }, { prClient, waypointExecutor })

    expect(result.changed).toBe(false)
    expect(result.previousStatus).toBe('pr_opened')
    expect(result.nextStatus).toBe('pr_opened')
    expect(result.legalLandmarksUpdated).toBe(false)
  })

  it('records deferred when Forgejo reports a closed unmerged PR', async () => {
    const registry = trustedRegistry()
    const prClient: FirmVaultDocumentPrStatusClient = async () => ({
      state: 'closed',
      prNumber: 124,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/124',
      branch: 'ingest/2026-05-08-rejected',
      closedAt: '2026-05-08T14:00:00.000Z',
    })
    const handoffStatuses: string[] = []
    const waypointExecutor: WaypointCommandExecutor = async (spec) => {
      handoffStatuses.push(String(spec.args[spec.args.indexOf('--status') + 1]))
      return {
        exitCode: 0,
        stdout: JSON.stringify({ document_id: 'document-002', handoff: { status: 'deferred' } }),
        stderr: '',
      }
    }

    const result = await syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-002',
      handoff: { status: 'pr_opened', prNumber: 124 },
    }, { prClient, waypointExecutor })

    expect(result.changed).toBe(true)
    expect(result.nextStatus).toBe('deferred')
    expect(result.completedAt).toBe('2026-05-08T14:00:00.000Z')
    expect(handoffStatuses).toEqual(['deferred'])
    expect(result.legalLandmarksUpdated).toBe(false)
  })

  it('rejects unsafe requests before reading Forgejo or mutating Waypoint', async () => {
    const registry = trustedRegistry()
    const prClient: FirmVaultDocumentPrStatusClient = async () => {
      throw new Error('pr client should not be called')
    }
    const waypointExecutor: WaypointCommandExecutor = async () => {
      throw new Error('waypoint executor should not be called')
    }

    await expect(syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: '../escape',
      documentId: 'document-001',
      handoff: { status: 'pr_opened', prNumber: 123 },
    }, { prClient, waypointExecutor })).rejects.toThrow('Invalid FirmVault case slug: ../escape')

    await expect(syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: '   ',
      handoff: { status: 'pr_opened', prNumber: 123 },
    }, { prClient, waypointExecutor })).rejects.toThrow('FirmVault documentId is required')

    await expect(syncFirmVaultDocumentPrStatusWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      handoff: { status: 'submitted' },
    }, { prClient, waypointExecutor })).rejects.toThrow('FirmVault document handoff must include prNumber, prUrl, or branch before PR sync')
  })
})
