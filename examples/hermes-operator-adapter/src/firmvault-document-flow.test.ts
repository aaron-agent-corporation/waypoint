import { describe, expect, it } from 'vitest'

import { parseFirmVaultCasesRegistry } from './firmvault-case-bootstrap.ts'
import {
  processFirmVaultScannedDocumentWithHermesOperator,
  type FirmVaultDocumentFlowPipelineRunner,
} from './firmvault-document-flow.ts'
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

describe('FirmVault document flow adapter', () => {
  it('adds a scanned PDF, runs the pipeline, records an opened PR handoff, and does not claim legal landmark updates', async () => {
    const registry = trustedRegistry()
    const waypointCalls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const waypointExecutor: WaypointCommandExecutor = async (spec) => {
      waypointCalls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
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
    const pipelineCalls: Array<{ pipelineRepoPath: string; sourcePdf: string; dryRun?: boolean }> = []
    const pipelineRunner: FirmVaultDocumentFlowPipelineRunner = async (request) => {
      pipelineCalls.push({
        pipelineRepoPath: request.pipelineRepoPath,
        sourcePdf: request.sourcePdf,
        ...(request.dryRun ? { dryRun: true } : {}),
      })
      return {
        ok: true,
        status: 'pr_opened',
        pipelineRepoPath: request.pipelineRepoPath,
        sourcePdf: request.sourcePdf,
        branch: 'ingest/2026-05-08-deadbeef',
        prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
        prNumber: 123,
        segmentsCommitted: 4,
        segmentsParked: 1,
        stdout: '{"FORGEJO_API_TOKEN":"[REDACTED]"}',
        stderr: '',
        summary: 'FirmVault document pipeline opened PR #123.',
      }
    }

    const result = await processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
      note: 'Daily Mail scan',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
    }, { waypointExecutor, pipelineRunner })

    expect(result).toMatchObject({
      ok: true,
      casesRootKey: 'pi',
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      documentPath: 'documents/inbox/daily-mail.pdf',
      handoffStatus: 'pr_opened',
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
      segmentsCommitted: 4,
      segmentsParked: 1,
      legalLandmarksUpdated: false,
      summary: 'FirmVault document document-001 added, pipeline status pr_opened recorded, legal landmarks unchanged.',
    })
    expect(result.pipelineStdout).toContain('[REDACTED]')
    expect(result.pipelineStdout).not.toContain('abc123secret')
    expect(pipelineCalls).toEqual([
      {
        pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
        sourcePdf: '/trusted/scans/daily-mail.pdf',
      },
    ])
    expect(waypointCalls.map((call) => call.args[2])).toEqual(['add-document', 'document-handoff'])
    expect(waypointCalls[1].args).toEqual([
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
    ])
  })

  it('records submitted when a dry-run pipeline stages a branch without PR metadata', async () => {
    const registry = trustedRegistry()
    const statuses: string[] = []
    const waypointExecutor: WaypointCommandExecutor = async (spec) => {
      if (spec.args.includes('document-handoff')) statuses.push(String(spec.args[spec.args.indexOf('--status') + 1]))
      if (spec.args.includes('add-document')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ document_id: 'document-002', path: 'documents/inbox/dry-run.pdf' }),
          stderr: '',
        }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ document_id: 'document-002', handoff: { status: 'submitted' } }),
        stderr: '',
      }
    }
    const pipelineRunner: FirmVaultDocumentFlowPipelineRunner = async (request) => ({
      ok: true,
      status: 'submitted',
      pipelineRepoPath: request.pipelineRepoPath,
      sourcePdf: request.sourcePdf,
      branch: 'ingest/2026-05-08-dryrun',
      prUrl: null,
      prNumber: null,
      segmentsCommitted: 2,
      segmentsParked: 0,
      stdout: '{}',
      stderr: '',
      summary: 'staged branch',
    })

    const result = await processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: '/trusted/scans/dry-run.pdf',
      kind: 'unknown',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      dryRun: true,
    }, { waypointExecutor, pipelineRunner })

    expect(result.handoffStatus).toBe('submitted')
    expect(result.prUrl).toBeNull()
    expect(result.prNumber).toBeNull()
    expect(statuses).toEqual(['submitted'])
    expect(result.legalLandmarksUpdated).toBe(false)
  })

  it('records failed handoff metadata when the pipeline exits non-zero', async () => {
    const registry = trustedRegistry()
    const handoffArgs: string[][] = []
    const waypointExecutor: WaypointCommandExecutor = async (spec) => {
      if (spec.args.includes('document-handoff')) handoffArgs.push([...spec.args])
      if (spec.args.includes('add-document')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ document_id: 'document-003', path: 'documents/inbox/bad-scan.pdf' }),
          stderr: '',
        }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ document_id: 'document-003', handoff: { status: 'failed' } }),
        stderr: '',
      }
    }
    const pipelineRunner: FirmVaultDocumentFlowPipelineRunner = async (request) => ({
      ok: false,
      status: 'failed',
      pipelineRepoPath: request.pipelineRepoPath,
      sourcePdf: request.sourcePdf,
      branch: null,
      prUrl: null,
      prNumber: null,
      segmentsCommitted: 0,
      segmentsParked: 0,
      stdout: '',
      stderr: 'OPENROUTER_API_KEY=[REDACTED]',
      summary: 'failed',
    })

    const result = await processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: '/trusted/scans/bad-scan.pdf',
      kind: 'unknown',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
    }, { waypointExecutor, pipelineRunner })

    expect(result.ok).toBe(false)
    expect(result.handoffStatus).toBe('failed')
    expect(result.pipelineStderr).toContain('[REDACTED]')
    expect(handoffArgs[0]).toContain('failed')
    expect(result.legalLandmarksUpdated).toBe(false)
  })

  it('rejects unsafe flow inputs before invoking Waypoint or the external pipeline', async () => {
    const registry = trustedRegistry()
    const waypointExecutor: WaypointCommandExecutor = async () => {
      throw new Error('waypoint executor should not be called')
    }
    const pipelineRunner: FirmVaultDocumentFlowPipelineRunner = async () => {
      throw new Error('pipeline runner should not be called')
    }

    await expect(processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: '../escape',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
    }, { waypointExecutor, pipelineRunner })).rejects.toThrow('Invalid FirmVault case slug: ../escape')

    await expect(processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: 'daily-mail.pdf',
      kind: 'unknown',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
    }, { waypointExecutor, pipelineRunner })).rejects.toThrow('FirmVault document source must be an absolute path')

    await expect(processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: '/trusted/scans/daily-mail.txt',
      kind: 'unknown',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
    }, { waypointExecutor, pipelineRunner })).rejects.toThrow('FirmVault document pipeline source must be a PDF')

    await expect(processFirmVaultScannedDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
      pipelineRepoPath: 'relative/pipeline',
    }, { waypointExecutor, pipelineRunner })).rejects.toThrow('FirmVault document pipeline repo path must be absolute')
  })
})
