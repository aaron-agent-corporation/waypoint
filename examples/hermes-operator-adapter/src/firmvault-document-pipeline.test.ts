import { describe, expect, it } from 'vitest'

import {
  runFirmVaultDocumentPipelineWithHermesOperator,
  type FirmVaultDocumentPipelineExecutor,
} from './firmvault-document-pipeline.ts'

describe('FirmVault document pipeline adapter', () => {
  it('invokes the configured Python pipeline repo with explicit uv args and parses Forgejo PR metadata', async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: FirmVaultDocumentPipelineExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          pdf: '/trusted/scans/daily-mail.pdf',
          branch_name: 'ingest/2026-05-08-deadbeef',
          pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/123',
          pr_number: 123,
          segments_committed: 4,
          segments_parked: 1,
          head_sha: 'abc1234',
          original_pdf_relative_path: '_review/ingest/2026-05-08-deadbeef/daily-mail.pdf',
          duration_seconds: 3.21,
        }),
        stderr: '',
      }
    }

    const result = await runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      workflow: 'forgejo',
    }, { executor })

    expect(calls).toEqual([
      {
        command: 'uv',
        args: [
          'run',
          'firmvault_ingest_once',
          'ingest',
          '/trusted/scans/daily-mail.pdf',
          '--workflow',
          'forgejo',
        ],
        cwd: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      status: 'pr_opened',
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      branch: 'ingest/2026-05-08-deadbeef',
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      prNumber: 123,
      segmentsCommitted: 4,
      segmentsParked: 1,
      summary: 'FirmVault document pipeline opened PR #123 for /trusted/scans/daily-mail.pdf on ingest/2026-05-08-deadbeef.',
    })
    expect(result.stdout).toContain('"pr_number":123')
  })

  it('supports dry-run branch staging without treating it as an opened PR', async () => {
    const calls: Array<{ args: readonly string[] }> = []
    const executor: FirmVaultDocumentPipelineExecutor = async (spec) => {
      calls.push({ args: spec.args })
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          pdf: '/trusted/scans/daily-mail.pdf',
          branch_name: 'ingest/2026-05-08-deadbeef',
          pr_url: null,
          pr_number: null,
          segments_committed: 2,
          segments_parked: 0,
        }),
        stderr: '',
      }
    }

    const result = await runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      dryRun: true,
    }, { executor })

    expect(calls[0].args).toContain('--dry-run')
    expect(result.status).toBe('submitted')
    expect(result.prUrl).toBeNull()
    expect(result.prNumber).toBeNull()
  })

  it('redacts token-like secrets from stdout and stderr before returning them', async () => {
    const executor: FirmVaultDocumentPipelineExecutor = async () => ({
      exitCode: 1,
      stdout: '{"error":"FORGEJO_API_TOKEN=abc123secret456","pr_number":null}',
      stderr: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789\nOPENROUTER_API_KEY=sk-or-v1-secret',
    })

    const result = await runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
    }, { executor })

    expect(result.ok).toBe(false)
    expect(result.stdout).not.toContain('abc123secret456')
    expect(result.stderr).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(result.stderr).not.toContain('sk-or-v1-secret')
    expect(result.stdout).toContain('FORGEJO_API_TOKEN=[REDACTED]')
    expect(result.stderr).toContain('Bearer [REDACTED]')
    expect(result.stderr).toContain('OPENROUTER_API_KEY=[REDACTED]')
  })

  it('rejects unsafe pipeline adapter inputs before invoking the pipeline', async () => {
    const executor: FirmVaultDocumentPipelineExecutor = async () => {
      throw new Error('executor should not be called')
    }

    await expect(runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: 'relative/pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
    }, { executor })).rejects.toThrow('FirmVault document pipeline repo path must be absolute')

    await expect(runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: 'daily-mail.pdf',
    }, { executor })).rejects.toThrow('FirmVault document pipeline source PDF must be an absolute path')

    await expect(runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.txt',
    }, { executor })).rejects.toThrow('FirmVault document pipeline source must be a PDF')

    await expect(runFirmVaultDocumentPipelineWithHermesOperator({
      pipelineRepoPath: '/Users/aaronwhaley/Github/firmvault-document-pipeline',
      sourcePdf: '/trusted/scans/daily-mail.pdf',
      workflow: 'direct' as never,
    }, { executor })).rejects.toThrow('FirmVault document pipeline adapter only supports workflow forgejo')
  })
})
