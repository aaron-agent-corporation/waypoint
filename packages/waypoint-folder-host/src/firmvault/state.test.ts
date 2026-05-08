import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  FIRMVAULT_CASE_STATE_FILES,
  FIRMVAULT_LANDMARK_SLUGS,
  initFirmVaultCaseState,
  readFirmVaultLandmarkProjection,
} from './state.ts'

async function tempCaseRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-state-'))
}

async function patchYaml(path: string, patcher: (value: any) => void): Promise<void> {
  const parsed = yamlParse(await readFile(path, 'utf8')) as any
  patcher(parsed)
  await writeFile(path, yamlStringify(parsed), 'utf8')
}

describe('FirmVault case state contract', () => {
  it('initializes product-owned FirmVault YAML state with all landmarks unsatisfied', async () => {
    const root = await tempCaseRoot()

    const result = await initFirmVaultCaseState(root, {
      caseType: 'personal_injury',
      caseSlug: 'smith-v-acme',
      now: new Date('2026-05-08T00:00:00.000Z'),
    })

    expect(result.stateDir).toBe(join(root, '.waypoint', 'firmvault'))
    for (const relativePath of FIRMVAULT_CASE_STATE_FILES) {
      expect(existsSync(join(result.stateDir, relativePath))).toBe(true)
    }

    const projection = await readFirmVaultLandmarkProjection(root)
    expect(Object.keys(projection.landmarks)).toEqual([...FIRMVAULT_LANDMARK_SLUGS])
    for (const slug of FIRMVAULT_LANDMARK_SLUGS) {
      expect(projection.landmarks[slug].satisfied).toBe(false)
      expect(projection.landmarks[slug].evidence).toEqual([])
    }
    expect(projection.warnings).toEqual([])
  })

  it('projects full_intake_complete from explicit client statuses and existing evidence', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'client'), { recursive: true })
    await mkdir(join(root, 'documents', 'signed'), { recursive: true })
    await writeFile(join(root, 'client', 'intake.md'), '# Intake complete\n', 'utf8')
    await writeFile(join(root, 'documents', 'signed', 'fee-agreement.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'signed', 'hipaa.pdf'), 'fixture', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'client.yaml'), (clientState) => {
      clientState.client.intake.status = 'complete'
      clientState.client.intake.evidence = [{ path: 'client/intake.md' }]
      clientState.client.contracts.fee_agreement.status = 'signed'
      clientState.client.contracts.fee_agreement.evidence = [{ path: 'documents/signed/fee-agreement.pdf' }]
      clientState.client.authorizations.hipaa.status = 'signed'
      clientState.client.authorizations.hipaa.evidence = [{ path: 'documents/signed/hipaa.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.full_intake_complete).toMatchObject({ satisfied: true })
    expect(projection.landmarks.full_intake_complete.evidence.map((item) => item.path)).toEqual([
      'client/intake.md',
      'documents/signed/fee-agreement.pdf',
      'documents/signed/hipaa.pdf',
    ])
  })

  it('projects demand and settlement landmarks from explicit status fields', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'documents', 'outgoing'), { recursive: true })
    await mkdir(join(root, 'documents', 'settlement'), { recursive: true })
    await writeFile(join(root, 'documents', 'outgoing', 'demand.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'settlement', 'release.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'settlement', 'distribution.pdf'), 'fixture', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'demand.yaml'), (demandState) => {
      demandState.demand.status = 'sent'
      demandState.demand.evidence = [{ path: 'documents/outgoing/demand.pdf' }]
    })
    await patchYaml(join(root, '.waypoint', 'firmvault', 'settlement.yaml'), (settlementState) => {
      settlementState.settlement.status = 'signed'
      settlementState.settlement.evidence = [{ path: 'documents/settlement/release.pdf' }]
      settlementState.settlement.distribution.status = 'complete'
      settlementState.settlement.distribution.evidence = [{ path: 'documents/settlement/distribution.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.demand_sent.satisfied).toBe(true)
    expect(projection.landmarks.settlement_reached.satisfied).toBe(true)
    expect(projection.landmarks.final_distribution_complete.satisfied).toBe(true)
  })

  it('keeps landmarks unsatisfied when explicit status lacks existing evidence', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })

    await patchYaml(join(root, '.waypoint', 'firmvault', 'demand.yaml'), (demandState) => {
      demandState.demand.status = 'sent'
      demandState.demand.evidence = [{ path: 'documents/outgoing/missing-demand.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.demand_sent.satisfied).toBe(false)
    expect(projection.landmarks.demand_sent.evidence).toEqual([])
    expect(projection.warnings).toContain(
      'demand_sent evidence path does not exist: documents/outgoing/missing-demand.pdf',
    )
  })
})
