/**
 * The VERIFY half of qualify → record → verify (S2, item 52): every
 * production construction re-digests the pinned evidence and re-checks the
 * conformance floor. These tests are the offline proof that a record whose
 * evidence was edited, swapped, lost, or signed by a role name refuses.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { REQUIRED_PROBES } from '../provider.ts'
import {
  loadSandboxAdmissionRecord,
  qualificationEvidenceProblem,
  sha256HexOf,
  type SandboxAdmissionRecord,
} from './cloud.ts'

const QUALIFIED_IMAGE = `localhost/waypoint/cordis-worker@sha256:${'ab'.repeat(32)}`

function passingEvidence(): Record<string, unknown> {
  return {
    enterable: true,
    healthy: true,
    image_digest: QUALIFIED_IMAGE,
    probes: Object.entries(REQUIRED_PROBES).map(([id, admitted]) => ({
      id,
      result: admitted[0],
      secret_plaintext_available: false,
    })),
  }
}

describe('admission record verify-on-load', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function writeFixture(options?: {
    evidence?: Record<string, unknown>
    record?: Partial<SandboxAdmissionRecord> & Record<string, unknown>
    tamperEvidenceAfterDigest?: string
  }): Promise<string> {
    dir = await mkdtemp(path.join(tmpdir(), 'admission-'))
    const evidenceJson = `${JSON.stringify(options?.evidence ?? passingEvidence(), null, 2)}\n`
    const evidencePath = path.join(dir, 'qualification.json')
    await writeFile(evidencePath, evidenceJson, 'utf8')
    const record = {
      schema_version: 1,
      selected_provider: 'fly-sprites',
      qualification_digest: sha256HexOf(evidenceJson),
      qualification_evidence: 'qualification.json',
      selection_status: 'APPROVED',
      authority: 'human',
      reviewer: 'aaron',
      reviewed_at: '2026-08-27T12:00:00.000Z',
      dual_active_refused: true,
      ...options?.record,
    }
    const recordPath = path.join(dir, 'admission-record.json')
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    if (options?.tamperEvidenceAfterDigest !== undefined) {
      await writeFile(evidencePath, options.tamperEvidenceAfterDigest, 'utf8')
    }
    return recordPath
  }

  it('loads a record whose evidence digests clean and passes the floor', async () => {
    const recordPath = await writeFixture()
    const record = loadSandboxAdmissionRecord(recordPath)
    expect(record.selected_provider).toBe('fly-sprites')
    expect(record.reviewer).toBe('aaron')
  })

  it('carries the qualified image out of the evidence — the admission says WHICH bundle (route-013)', async () => {
    const recordPath = await writeFixture()
    expect(loadSandboxAdmissionRecord(recordPath).admitted_image_digest).toBe(QUALIFIED_IMAGE)
  })

  it('refuses evidence that names no image_digest — an admission must say which bundle it admits', async () => {
    const evidence = passingEvidence()
    delete evidence.image_digest
    const recordPath = await writeFixture({ evidence })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/names no image_digest/)
  })

  it('refuses when the evidence changed after it was recorded — the digest is a pin, not a decoration', async () => {
    const recordPath = await writeFixture({
      tamperEvidenceAfterDigest: `${JSON.stringify({ ...passingEvidence(), healthy: true, edited: true }, null, 2)}\n`,
    })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/evidence changed after it was recorded/)
  })

  it('refuses evidence that no longer holds the floor, even when the digest matches', async () => {
    const evidence = passingEvidence()
    ;(evidence.probes as Record<string, unknown>[]).find((p) => p.id === 'raw-ip-egress')!.result = 'allowed'
    const recordPath = await writeFixture({ evidence })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/raw-ip-egress.*outside its admitted set/)
  })

  it('refuses a reviewer that is a role name — a human must sign', async () => {
    const recordPath = await writeFixture({ record: { reviewer: 'system' } })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/role name, not a human/)
  })

  it('refuses a record with an unknown field — the shape is closed', async () => {
    const recordPath = await writeFixture({ record: { surprise: true } })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/unknown record field 'surprise'/)
  })

  it('refuses a record that pins no evidence path', async () => {
    const recordPath = await writeFixture({ record: { qualification_evidence: '' } })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/qualification_evidence/)
  })

  it('refuses when the pinned evidence file is missing — a lost file is never a pass', async () => {
    const recordPath = await writeFixture({ record: { qualification_evidence: 'gone.json' } })
    expect(() => loadSandboxAdmissionRecord(recordPath)).toThrow(/cannot read qualification evidence/)
  })
})

describe('qualificationEvidenceProblem — the floor check itself', () => {
  it('passes complete passing evidence', () => {
    expect(qualificationEvidenceProblem(passingEvidence())).toBeUndefined()
  })

  it('names a missing required probe', () => {
    const evidence = passingEvidence()
    evidence.probes = (evidence.probes as Record<string, unknown>[]).filter((p) => p.id !== 'denied-host-egress')
    expect(qualificationEvidenceProblem(evidence)).toContain("missing required probe 'denied-host-egress'")
  })

  it('refuses evidence that is not enterable — a sandbox nobody can enter proved nothing', () => {
    expect(qualificationEvidenceProblem({ ...passingEvidence(), enterable: false })).toContain('enterable')
  })

  it('refuses a probe that exposed secret plaintext', () => {
    const evidence = passingEvidence()
    ;(evidence.probes as Record<string, unknown>[])[0]!.secret_plaintext_available = true
    expect(qualificationEvidenceProblem(evidence)).toContain('secret plaintext')
  })
})
